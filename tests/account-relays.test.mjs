import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as nostr from 'nostr-tools';

const modules = new Map();
let scripts = {}, instances = [];
class Socket {
  readyState = 0; frames = [];
  constructor(url) {
    this.url = url; instances.push(this);
    if (scripts[url] !== 'connecting') queueMicrotask(() => this.open());
  }
  open() {if(this.readyState===3)return;this.readyState=1;this.onopen?.();}
  send(raw) {
    const frame=JSON.parse(raw);this.frames.push(frame);
    if(frame[0]==='CLOSE')return;
    queueMicrotask(()=>{
      const script=scripts[this.url];
      if(script==='fail'){this.onerror?.();return;}
      if(script==='closed'){this.onmessage?.({data:JSON.stringify(['CLOSED',frame[1],'blocked'])});return;}
      if(script==='silent'||script==='connecting')return;
      if(frame[0]==='REQ'){
        for(const event of script??[])this.onmessage?.({data:JSON.stringify(['EVENT',frame[1],event])});
        this.onmessage?.({data:JSON.stringify(['EOSE',frame[1]])});
      }else if(frame[0]==='EVENT'){
        this.onmessage?.({data:JSON.stringify(['OK','unrelated',true,''])});
        if(typeof script==='boolean')this.onmessage?.({data:JSON.stringify(['OK',frame[1].id,script,''])});
      }
    });
  }
  close(){this.readyState=3;}
}
async function load(name) {
  if(modules.has(name))return modules.get(name);
  const source=await fs.readFile(`lib/${name}.ts`,'utf8'),deps={'nostr-tools':{...nostr,verifyEvent:event=>nostr.verifyEvent(JSON.parse(JSON.stringify(event)))}};
  for(const match of source.matchAll(/from '\.\/([^']+)'/g))deps[`./${match[1]}`]=await load(match[1]);
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],URL,TextEncoder,setTimeout,clearTimeout,AbortController,WebSocket:Socket,console});
  modules.set(name,exports);return exports;
}
const api=await load('account-relays');
const {RELAY_STORAGE}=await load('relays');
const sk=new Uint8Array(32);sk[31]=1;const owner=nostr.getPublicKey(sk),other='f'.repeat(64),now=Math.floor(Date.now()/1000);
const a='wss://a.example/',b='wss://b.example/',c='wss://c.example/';
const make=(time,tags=[],secret=sk)=>nostr.finalizeEvent({kind:10002,created_at:time,content:'',tags},secret);
const old=make(now-20,[['r',a,'read'],['r',b,'write'],['custom','keep']]),newer=make(now-10,[['r',c]]);
const plain=x=>JSON.parse(JSON.stringify(x));
const signal=()=>new AbortController().signal;
const storage=new Map([[RELAY_STORAGE,JSON.stringify([{url:a,read:true,write:true}])]]),store={getItem:k=>storage.get(k)??null};
assert.equal(api.readAccountConnections(store,owner),null);assert.equal(api.readAccountConnections(store,other),null);
assert.equal(api.readAccountConnections(store,'')[0].url,a);
storage.set(api.accountRelayStorageKey(owner),'[]');assert.equal(api.readAccountConnections(store,owner).length,0);assert.equal(api.readAccountConnections(store,other),null);
assert.deepEqual(plain(api.accountConnections(null,old)),[{url:a,read:true,write:false},{url:b,read:true,write:true}]);
assert.equal(api.accountConnections([],old).length,0);assert(api.accountConnections(null,make(now-1)).every(r=>r.read&&!r.write));
assert(api.relayLookupUrls(null,old).includes(b));

scripts={[a]:[old],[b]:[newer]};let result=await api.loadAccountRelayList(owner,[a,b],signal());assert.equal(result.event.id,newer.id);assert(!result.partial);assert(instances.every(s=>s.readyState===3));
assert(instances.every(s=>s.frames.at(-1)?.[0]==='CLOSE'));assert(instances.every(s=>s.frames.every(f=>f[0]!=='EVENT')));
const tie=make(newer.created_at,[['r',a]]);scripts={[a]:[tie],[b]:[newer]};assert.equal((await api.loadAccountRelayList(owner,[a,b],signal())).event.id,[tie.id,newer.id].sort()[0]);
scripts={[a]:[old],[b]:'fail'};result=await api.loadAccountRelayList(owner,[a,b],signal());assert(result.partial);assert.equal(result.event.id,old.id);
scripts={[a]:[]};result=await api.loadAccountRelayList(owner,[a],signal());assert.equal(result.event,null);assert(!result.partial);
scripts={[a]:[make(now-1)]};result=await api.loadAccountRelayList(owner,[a],signal());assert(result.event);assert.equal(result.event.tags.length,0);assert(!result.partial);
for(const scenario of ['silent','closed','fail']){scripts={[a]:scenario};result=await api.loadAccountRelayList(owner,[a],signal(),3);assert(result.partial);assert.equal(result.event,null);}
for(const invalid of [{...old,content:'tampered'},{...old,pubkey:other},make(now+10000)]){scripts={[a]:[invalid]};result=await api.loadAccountRelayList(owner,[a],signal());assert(result.partial);assert.equal(result.event,null);}
scripts={[a]:'connecting'};const pending=api.loadAccountRelayList(owner,[a],signal(),100);const delayed=instances.at(-1);assert.equal(delayed.frames.length,0);scripts[a]=[old];delayed.open();assert.equal((await pending).event.id,old.id);
const abort=new AbortController();scripts={[a]:'connecting'};const aborted=api.loadAccountRelayList(owner,[a],abort.signal);abort.abort();await assert.rejects(()=>aborted,/中止/);assert.equal(instances.at(-1).readyState,3);

assert.throws(()=>api.buildRelayListEdit(old,newer,[],now),/更新/);assert.throws(()=>api.buildRelayListEdit(old,old,[],old.created_at),/時刻/);
const rows=[{url:a,read:true,write:false},{url:b,read:false,write:true},{url:c,read:true,write:true}];
const template=api.buildRelayListEdit(old,old,rows,now);assert.deepEqual(plain(template.tags),[['custom','keep'],['r',a,'read'],['r',b,'write'],['r',c]]);
assert.throws(()=>api.buildRelayListEdit(old,old,[{url:a,read:false,write:false}],now),/選択/);
for(const tags of [[['r','ws://a.example']], [['r',a,'future']], [['r',a,'read','extra']], Array.from({length:17},(_,i)=>['r',`wss://r${i}.example`])])assert.throws(()=>api.editableRelayRows(make(now-1,tags)),/編集/);
let published=0,signed=0;
const args={owner,base:old,rows,signal:signal(),currentOwner:()=>owner,load:async()=>({event:old,partial:false}),sign:async event=>{signed++;return nostr.finalizeEvent(plain(event),sk);},publish:async()=>{published++;return {confirmed:1,total:2};}};
result=await api.saveAccountRelayList(args);assert.equal(result.confirmed,1);assert.equal(published,1);
await assert.rejects(()=>api.saveAccountRelayList({...args,load:async()=>({event:null,partial:true})}),/一部/);assert.equal(signed,1);
await assert.rejects(()=>api.saveAccountRelayList({...args,load:async()=>({event:newer,partial:false})}),/更新/);
await assert.rejects(()=>api.saveAccountRelayList({...args,sign:async()=>{throw Error('denied');}}),/denied/);
await assert.rejects(()=>api.saveAccountRelayList({...args,sign:async event=>nostr.finalizeEvent({...plain(event),tags:[]},sk)}),/署名/);
await assert.rejects(()=>api.saveAccountRelayList({...args,sign:async event=>({...nostr.finalizeEvent(plain(event),sk),sig:'0'.repeat(128)})}),/署名/);
let partialReads=0;await assert.rejects(()=>api.saveAccountRelayList({...args,load:async()=>({event:old,partial:++partialReads===2})}),/一部/);
let reads=0;await assert.rejects(()=>api.saveAccountRelayList({...args,load:async()=>({event:++reads===1?old:newer,partial:false})}),/署名中/);
let current=owner;await assert.rejects(()=>api.saveAccountRelayList({...args,currentOwner:()=>current,sign:async event=>{current=other;return nostr.finalizeEvent(plain(event),sk);}}),/ログイン/);
const close=new AbortController();await assert.rejects(()=>api.saveAccountRelayList({...args,signal:close.signal,sign:async event=>{close.abort();return nostr.finalizeEvent(plain(event),sk);}}),/中止/);assert.equal(published,1);
result=await api.saveAccountRelayList({...args,publish:async()=>({confirmed:0,total:2})});assert.equal(result.confirmed,0);
let externalSigned;reads=0;await api.saveAccountRelayList({...args,load:async()=>{if(++reads===2)externalSigned.tags.length=0;return {event:old,partial:false};},sign:async event=>(externalSigned=nostr.finalizeEvent(plain(event),sk)),publish:async event=>{assert.deepEqual(plain(event.tags),plain(template.tags));assert(nostr.verifyEvent(plain(event)));return {confirmed:1,total:1};}});
scripts={[a]:true,[b]:false,[c]:'silent'};result=await api.publishAccountRelayList(old,[a,b,c],signal(),3);assert.equal(result.confirmed,1);assert.equal(result.total,3);assert(instances.every(s=>s.readyState===3));
scripts={[a]:'connecting'};const cancelPublish=new AbortController();const publication=api.publishAccountRelayList(old,[a],cancelPublish.signal);const unpublished=instances.at(-1);cancelPublish.abort();assert.equal((await publication).confirmed,0);assert.equal(unpublished.frames.length,0);

// Deliberately resolve old promises after account switch/logout; even a non-cooperative loader cannot commit them.
const jobs=[],states=[];
const session=new api.AccountRelaySession(state=>states.push(state),(key,urls,signal)=>new Promise(resolve=>jobs.push({key,urls,signal,resolve})));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
session.start(owner,[a]);assert.equal(jobs.length,1);session.reconnect(a);session.reconnect(a);assert.equal(jobs.length,1);
jobs[0].resolve({event:null,partial:true});await tick();assert.equal(jobs.length,2);assert(session.state.partial);
session.start(other,[a]);assert(jobs[1].signal.aborted);jobs[1].resolve({event:old,partial:false});await tick();assert.equal(session.state.owner,other);assert.equal(session.state.event,null);
session.start('',[a]);jobs[2].resolve({event:old,partial:false});await tick();assert.equal(session.state.owner,'');assert.equal(session.state.event,null);assert(!session.state.loading);
session.start(owner,api.relayLookupUrls(null,old));jobs.at(-1).resolve({event:old,partial:false});await tick();assert.equal(session.state.event.id,old.id);assert(!session.state.partial);
const beforeReconnect=jobs.length;session.reconnect(a);assert.equal(jobs.length,beforeReconnect+1);jobs.at(-1).resolve({event:old,partial:false});await tick();
const refresh=session.refresh();jobs.at(-1).resolve({event:null,partial:false});await refresh;assert.equal(session.state.event.id,old.id);assert(session.state.partial);
session.reconnect(a);jobs.at(-1).resolve({event:newer,partial:false});await tick();assert.equal(session.state.event.id,newer.id);assert(jobs.at(-1).urls.includes(c));assert(session.state.loading);jobs.at(-1).resolve({event:newer,partial:false});await tick();assert(!session.state.partial);
const staleRead=session.refresh();session.accept(make(now-1,[['r',a]]));jobs.at(-1).resolve({event:old,partial:false});await staleRead;assert.equal(session.state.event.created_at,now-1);assert(!session.state.partial);session.stop();
console.log('PASS account relays: scoped storage, inbox/outbox projection, verified discovery/ties, delayed open/reconnect, partial/empty/missing states, lossy-list guards, exact signatures, pre/post-sign conflicts, close/account/logout cancellation, per-target ACKs and stale result isolation');
