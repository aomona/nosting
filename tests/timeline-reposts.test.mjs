import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {finalizeEvent,generateSecretKey} from 'nostr-tools';
await fs.mkdir('.sites-runtime',{recursive:true});
const dir=await fs.mkdtemp(resolve('.sites-runtime/timeline-reposts-'));
try{
 for(const name of ['relay-auth','timeline-reposts','relay-connections','repost','history-pager','quotes','feed-retention','mutes','reply-tags']){
  let output=ts.transpileModule(await fs.readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  output=output.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await fs.writeFile(`${dir}/${name}.mjs`,output);
 }
 const load=name=>import(pathToFileURL(`${dir}/${name}.mjs`));
 const {readTimelineRepost,repostOriginal,TimelineReposts}=await load('timeline-reposts');
 const {HistoryPager}=await load('history-pager');const {QuoteResolver}=await load('quotes');
 const {retainFeed}=await load('feed-retention');const {isEventMuted}=await load('mutes');const {makeReplyTags}=await load('reply-tags');
 const author=generateSecretKey(),reposter=generateSecretKey();
 const sign=(data,key=author)=>JSON.parse(JSON.stringify(finalizeEvent({kind:1,content:'original',tags:[],created_at:10,...data},key)));
 const original=sign({}),tags=[['e',original.id,'wss://hint.example/'],['p',original.pubkey]];
 const repost=(data={})=>sign({kind:6,created_at:100,content:JSON.stringify(original),tags,...data},reposter);
 const embedded=repost(),empty=repost({content:'',created_at:101});
 assert.equal(readTimelineRepost(embedded).event.id,original.id);
 assert.equal(readTimelineRepost(empty).id,original.id);assert.equal(readTimelineRepost(empty).event,undefined);
 assert.equal(readTimelineRepost(repost({tags:tags.slice(0,1)})).event.id,original.id,'p is optional');
 const invalid=[
  {...embedded,content:''}, {...embedded,id:'0'.repeat(64)}, {...embedded,sig:'0'.repeat(128)},
  repost({kind:16}),repost({tags:[]}),repost({tags:[['e',original.id]]}),repost({tags:[...tags,tags[0]]}),
  repost({tags:[tags[0],['p','1'.repeat(64)]]}),repost({tags:[...tags,['p','1'.repeat(64)]]}),
  repost({tags:[...tags,['k','16']]}),repost({content:'{'}),
  repost({content:JSON.stringify({...original,content:'tampered'})}),
  repost({content:JSON.stringify({...original,id:'1'.repeat(64)})}),
  repost({content:JSON.stringify({...original,sig:'0'.repeat(128)})}),
  repost({content:JSON.stringify(sign({content:'different ID'}))}),
  repost({content:JSON.stringify(sign({kind:16}))}),
 ];
 for(const value of invalid)assert.equal(readTimelineRepost(value),null);
 const otherKind=sign({kind:16});assert.equal(readTimelineRepost(repost({content:JSON.stringify(otherKind),tags:[['e',otherKind.id,'wss://hint.example/']]})),null);
 assert.equal(repostOriginal(readTimelineRepost(empty),{...original,content:'modified'}),null);
 // Cached verification flags cannot authorize an object mutated after signing.
 const cached=finalizeEvent({kind:1,content:'cached',tags:[],created_at:1},author);
 cached.content='tampered';assert.equal(repostOriginal({id:cached.id},cached),null);
 const tick=()=>new Promise(r=>setImmediate(r));
 function socket(url){return {url,readyState:1,sent:[],send(frame){this.sent.push(JSON.parse(frame))}}}
 const a=socket('wss://a.example/'),b=socket('wss://b.example/'),write=socket('wss://write.example/');
 const quotes=new QuoteResolver(()=>[a,b,write],()=>[a.url,b.url],1000),resolved=[];
 const resolver=new TimelineReposts(id=>quotes.request(id),(event,note)=>resolved.push({event,note}));
 resolver.add(embedded);resolver.add(embedded);assert.equal(resolved.length,1);assert.equal(a.sent.length,0);
 resolver.add(empty);await tick();const sub=a.sent.at(-1)[1];
 assert.equal(write.sent.length,0);assert.deepEqual(a.sent.at(-1)[2],{ids:[original.id],kinds:[1],limit:1});
 quotes.disconnect(a.url);quotes.receive(b.url,['EVENT',sub,{...original,content:'bad'}]);
 assert.equal(resolved.length,1);quotes.receive(b.url,['EVENT',sub,original]);await tick();
 assert.equal(resolved.length,2);assert.equal(resolved[1].event.id,empty.id);assert.equal(resolved[1].note.id,original.id);
 assert.equal(a.sent.at(-1)[0],'CLOSE');assert.equal(b.sent.at(-1)[0],'CLOSE');
 // Duplicate relay deliveries retain repost time and separate original/row identities.
 const feed=retainFeed([], [original,embedded,empty,embedded]);assert.deepEqual(feed.map(n=>n.id),[empty.id,embedded.id,original.id]);
 assert.deepEqual(feed.map(n=>n.created_at),[101,100,10]);assert.equal(makeReplyTags(resolved[1].note).find(t=>t[0]==='e')[1],original.id);
 assert(isEventMuted(empty,{users:[empty.pubkey],words:[]}));assert(isEventMuted(empty,{users:[original.pubkey],words:[]}));assert(isEventMuted(resolved[1].note,{users:[],words:['original']}));
 let attempts=0;const retried=[];const retry=new TimelineReposts(async()=>{attempts++;return attempts===1?{}:{event:original}},(_,n)=>retried.push(n));
 retry.add(empty);await tick();assert.equal(retried.length,0);retry.retry();await tick();assert.equal(retried.length,1);assert.equal(attempts,2);
 let release;const late=[];const stale=new TimelineReposts(()=>new Promise(r=>release=r),(...v)=>late.push(v));stale.add(empty);await tick();stale.reset();release({event:original});await tick();assert.equal(late.length,0);
 // A reconnect while a lookup is finishing must also retry its failure.
 let finish;let calls=0;const raced=[];const race=new TimelineReposts(()=>++calls===1?new Promise(r=>finish=r):Promise.resolve({event:original}),(...v)=>raced.push(v));race.add(empty);await tick();race.retry();finish({});await tick();assert.equal(raced.length,1);
 const boundedCalls=[];const bounded=new TimelineReposts(id=>{boundedCalls.push(id);return new Promise(()=>{})},()=>{},8);
 for(let i=0;i<20;i++)bounded.add(repost({content:'',created_at:200+i}));await tick();assert.equal(boundedCalls.length,4);bounded.reset();
 // Home history counts repost envelopes, including their own timestamp boundaries.
 const pager=new HistoryPager([1,6]),healthy=socket(a.url),broken=socket(b.url);broken.send=()=>{throw Error('offline')};
 pager.observe(a.url,empty);const page=pager.page([healthy,broken],[a.url,b.url]);const req=healthy.sent[0];assert.deepEqual(req[2].kinds,[1,6]);assert.equal(req[2].until,101);
 pager.receive(a.url,['EVENT',req[1]],embedded);pager.receive(a.url,['EVENT',req[1]],embedded);pager.receive(a.url,['EVENT',req[1]],repost({kind:16}));pager.receive(a.url,['EOSE',req[1]]);
 const result=await page;assert.equal(result.events.length,1);assert.equal(result.events[0].id,embedded.id);assert.equal(pager.cursors.get(a.url).until,100);assert.equal(result.error,'');assert(result.warning);pager.reconnect(b.url);assert(!pager.failed.has(b.url));
 const authorPager=new HistoryPager(),authorSocket=socket(a.url);const authorPage=authorPager.page([authorSocket],[a.url],original.pubkey);const authorReq=authorSocket.sent[0];assert.deepEqual(authorReq[2].kinds,[1]);authorPager.receive(a.url,['EVENT',authorReq[1]],embedded);authorPager.receive(a.url,['EOSE',authorReq[1]]);assert.equal((await authorPage).events.length,0);
 // Inclusive same-second pages expand using raw envelope count, never source time.
 const boundary=new HistoryPager([1,6]),same=socket(a.url);boundary.observe(a.url,embedded);const pending=boundary.page([same],[a.url]);const id=same.sent[0][1];
 for(let i=0;i<50;i++)boundary.receive(a.url,['EVENT',id],repost({tags:[...tags,['nonce',String(i)]]}));boundary.receive(a.url,['EOSE',id]);await pending;assert.equal(boundary.cursors.get(a.url).until,100);assert.equal(boundary.cursors.get(a.url).limit,100);
 quotes.reset();resolver.reset();retry.reset();race.reset();
 console.log('PASS timeline reposts: signed synthetic events, NIP18 ID/kind/tag/signature checks, empty-source lookup, partial failures/reconnect races/reset, bounded work, duplicate/time identity, mute/reply targets, mixed-kind history and timestamp overlap');
}finally{await fs.rm(dir,{recursive:true,force:true})}
