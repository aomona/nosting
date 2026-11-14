import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {finalizeEvent, generateSecretKey, getPublicKey} from 'nostr-tools';
await fs.mkdir('.sites-runtime', {recursive:true});
const dir = await fs.mkdtemp(resolve('.sites-runtime/following-'));
try {
  for (const name of ['relay-auth','following-feed','relay-connections','relay-discovery','relays','latest-event','history-pager','feed-retention','timeline-reposts','repost','quotes']) {
    const source = await fs.readFile(`lib/${name}.ts`, 'utf8');
    const output = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
    await fs.writeFile(`${dir}/${name}.mjs`, output);
  }
  const {createFollowingFeed, followingRoutes, FOLLOWING_RELAY_LIMIT} = await import(pathToFileURL(`${dir}/following-feed.mjs`));
  const {matchesRelayFilter} = await import(pathToFileURL(`${dir}/relay-connections.mjs`));
  const key = generateSecretKey(), other = generateSecretKey(), author = getPublicKey(key);
  const sign = (data, secret = key) => JSON.parse(JSON.stringify(finalizeEvent({kind:1, content:'local fixture', tags:[], created_at:1000, ...data}, secret)));
  const seed = 'wss://seed.example/', outbox = 'wss://outbox.example/', bad = 'wss://bad.example/';
  const list = sign({kind:10002,tags:[['r', outbox, 'write'],['r','wss://read.example/','read'],['r',bad]], created_at:2000});
  const posts = Array.from({length:140}, (_,i) => sign({created_at:800-i, content:`old following ${i}`}));
  const global = Array.from({length:60}, (_,i) => sign({created_at:5000-i,content:`global ${i}`},other));
  assert(!global.slice(0,45).some(e=>e.pubkey===author));
  let allSockets = [], requests = [], maximum = 0, broken = true, silent = false, delay = 1, rogue = null, silentUrl = null;
  const db = new Map([[seed,[list,...global]],[outbox,posts],[bad,[]]]);
  class Socket {
    readyState=0; onopen=null; onmessage=null; onerror=null; onclose=null;
    constructor(url) { this.url=url; allSockets.push(this); maximum=Math.max(maximum,allSockets.filter(s=>s.readyState!==3).length); setTimeout(()=>{if(this.readyState!==3){this.readyState=1;this.onopen?.()}},1); }
    send(data) {
      const frame=JSON.parse(data);requests.push({url:this.url,frame});
      assert(['REQ','CLOSE'].includes(frame[0]), 'publication forbidden');
      if(frame[0]!=='REQ')return;
      const [,id,f]=frame;
      setTimeout(()=>{
        if(this.readyState===3||silent||this.url===silentUrl)return;
        if(this.url===bad&&broken){this.deliver(['CLOSED',id,'mock outage']);return;}
        if(rogue&&f.kinds.includes(10002))this.deliver(['EVENT',id,rogue]);
        const rows=(db.get(this.url)||[]).filter(e=>matchesRelayFilter(e,f)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,f.limit);
        // A relay deliberately sends invalid signatures and out-of-filter authors.
        if(f.kinds.includes(1)){this.deliver(['EVENT',id,{...posts[0],content:'forged'}]);this.deliver(['EVENT',id,global[0]]);}
        for(const e of rows){this.deliver(['EVENT',id,e]);this.deliver(['EVENT',id,e]);}
        this.deliver(['EOSE',id]);
      },delay);
    }
    deliver(frame){this.onmessage?.({data:JSON.stringify(frame)});}
    close(){this.readyState=3;}
  }
  const options={socket:url=>new Socket(url),timeout:80,now:()=>6000};
  const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('wait timeout');};
  let snapshot;const snapshots=[];
  const feed=createFollowingFeed([author], [seed], s=>{snapshot=s;snapshots.push(s)},options);
  await wait(()=>snapshot&&!snapshot.initial&&!snapshot.loading);
  assert.equal(snapshot.events.length,50,'old followed posts load independently of global latest 45');
  assert(snapshot.failed>0,'partial failure is visible');
  assert(!allSockets.some(s=>s.url==='wss://read.example/'),'NIP65 inbox is not an outbox');
  assert(snapshot.events.every(e=>e.pubkey===author&&e.content!=='forged'));
  await feed.loadOlder();await feed.loadOlder();await feed.loadOlder();
  assert(requests.some(r=>r.url===outbox&&r.frame[2]?.until===751),'history cursor comes from following page');
  assert.equal(snapshot.events.length,140);assert.equal(new Set(snapshot.events.map(e=>e.id)).size,140);
  const beforeRetry=requests.filter(r=>r.url===outbox&&r.frame[2]?.until!==undefined).length;
  broken=false;await feed.loadOlder(true);
  assert.equal(snapshot.failed,0);assert.equal(snapshot.done,true);
  assert.equal(requests.filter(r=>r.url===outbox&&r.frame[2]?.until!==undefined).length,beforeRetry,'retry only failed relay');
  const liveSocket=allSockets.findLast(s=>s.url===outbox&&s.readyState===1);
  const live=requests.findLast(r=>r.url===outbox&&r.frame[2]?.since!==undefined).frame;
  const fresh=sign({created_at:6001,content:'live'});liveSocket.deliver(['EVENT',live[1],fresh]);
  await wait(()=>snapshot.events.some(e=>e.id===fresh.id));
  const original=sign({created_at:10,content:'reposted original'},other);
  const repost=sign({kind:6,created_at:6002,content:JSON.stringify(original),tags:[['e',original.id,'wss://hint.example/'],['p',original.pubkey]]});
  liveSocket.deliver(['EVENT',live[1],repost]);liveSocket.deliver(['EVENT',live[1],repost]);
  await wait(()=>snapshot.originals[repost.id]);assert.equal(snapshot.events.filter(e=>e.id===repost.id).length,1);
  assert.equal(snapshot.originals[repost.id].id,original.id);
  const emptyRepost=sign({kind:6,created_at:6003,content:'',tags:repost.tags});db.get(outbox).push(original);
  liveSocket.deliver(['EVENT',live[1],emptyRepost]);await wait(()=>snapshot.originals[emptyRepost.id]);
  assert.equal(snapshot.originals[emptyRepost.id].id,original.id,'empty NIP18 source resolved using selected outboxes');
  assert(!allSockets.some(s=>s.url==='wss://hint.example/'));
  feed.stop();const stoppedCount=snapshots.length;liveSocket.deliver(['EVENT',live[1],sign({created_at:6004})]);
  await new Promise(r=>setTimeout(r,60));assert.equal(snapshots.length,stoppedCount);assert(allSockets.every(s=>s.readyState===3));
  assert(maximum<=FOLLOWING_RELAY_LIMIT);

  // Full same-second pages expand, deduplicate, and then reach the older event.
  db.set(outbox,[...Array.from({length:80},(_,i)=>sign({created_at:100,content:`boundary ${i}`})),sign({created_at:99})]);
  db.set(seed,[sign({kind:10002,tags:[['r',outbox,'write']]})]);
  const boundary=createFollowingFeed([author],[seed],s=>snapshot=s,options);
  await wait(()=>!snapshot.initial&&!snapshot.loading);await boundary.loadOlder();await boundary.loadOlder();
  assert.equal(snapshot.events.length,81);assert.equal(snapshot.done,true);
  const limits=requests.filter(r=>r.url===outbox&&r.frame[2]?.until===100).map(r=>r.frame[2].limit);
  assert(limits.includes(100));boundary.stop();

  // Cancellation during discovery and during a history page releases every socket,
  // ignores late replies, and never launches queued connections for the old owner.
  for(const phase of ['discovery','history']){
    silent=phase==='discovery';let count=0;
    const cancelled=createFollowingFeed([author],[seed],()=>count++,options);
    if(phase==='history'){await wait(()=>allSockets.some(s=>s.url===outbox&&s.readyState===1));silent=true;}
    cancelled.stop();const countAtStop=count;
    await new Promise(r=>setTimeout(r,100));assert.equal(count,countAtStop);assert(allSockets.every(s=>s.readyState===3));silent=false;
  }
  // Timeouts preserve healthy relay results; a retry resumes its untouched cursor.
  broken=false;silentUrl=bad;db.set(seed,[list]);db.set(outbox,posts);delay=1;
  const timeoutFeed=createFollowingFeed([author],[seed],s=>snapshot=s,{...options,timeout:500});
  await wait(()=>snapshot.events.length>0);assert(snapshot.loading,'healthy events are emitted before silent relay times out');
  await wait(()=>!snapshot.initial&&!snapshot.loading);assert(snapshot.failed>0);timeoutFeed.stop();silentUrl=null;
  // Untrusted relay lists are signature checked; replaceable ties use lowest ID.
  const oldList=sign({kind:10002,created_at:1,tags:[['r','wss://old.example/']]});
  rogue={...list,sig:'0'.repeat(128)};db.set(seed,[oldList]);db.set('wss://old.example/',[]);
  const verified=createFollowingFeed([author],[seed],s=>snapshot=s,options);
  await wait(()=>!snapshot.initial&&!snapshot.loading);assert(allSockets.some(s=>s.url==='wss://old.example/'));verified.stop();
  const many=sign({kind:10002,tags:Array.from({length:16},(_,i)=>['r',`wss://r${i}.example/`])});
  const plan=followingRoutes([author],new Map([[author,many]]),[seed]);assert.equal(plan.routes.size,6);assert(plan.partial);
  // Actual route fan-out obeys the connection cap, including discovery teardown.
  rogue=null;db.set(seed,[many]);maximum=0;
  const bounded=createFollowingFeed([author],[seed],s=>snapshot=s,options);
  await wait(()=>!snapshot.initial&&!snapshot.loading);assert.equal(maximum,6);assert(snapshot.partial);bounded.stop();
  // No authors must never fall back to an unfiltered public subscription.
  const count=requests.length;const empty=createFollowingFeed([], [seed],s=>snapshot=s,options);assert.equal(requests.length,count);assert(snapshot.done);empty.stop();
  console.log('PASS following: independent old authors history, NIP65 routing, bounds, signatures, partial failure/retry, live/history split, NIP18 originals, dedup, same-second cursor, cancellation, empty follows');
} finally { await fs.rm(dir,{recursive:true,force:true}); }
