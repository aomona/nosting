import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
const dir=resolve('.sites-runtime/reactions-test');await fs.mkdir(dir,{recursive:true});
for(const name of ['reactions','reaction-session','custom-emoji','note-media','relay-connections']){
 const source=await fs.readFile(`lib/${name}.ts`,'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 await fs.writeFile(`${dir}/${name}.mjs`,output);
}
try{
 const {ReactionState,ReactionWriter,reactionTemplate,deletionTemplate,reactionMatches,reactionKey}=await import(pathToFileURL(`${dir}/reactions.mjs`));
 const {ReactionSession}=await import(pathToFileURL(`${dir}/reaction-session.mjs`));
 const sk=generateSecretKey(),other=generateSecretKey(),owner=getPublicKey(sk),otherOwner=getPublicKey(other);
 const target=finalizeEvent({kind:1,created_at:1,content:'Local fixture',tags:[]},other);
 const sign=(template)=>finalizeEvent(template,sk);
 const like=sign(reactionTemplate(target,{content:'+'},2));
 const unicode=sign(reactionTemplate(target,{content:'🎉'},3));
 const custom=sign(reactionTemplate(target,{content:':party:',emoji:{code:'party',url:'https://example.invalid/party.png'}},4));
 assert(reactionMatches(like,owner,target));
 assert.equal(reactionKey(sign({...reactionTemplate(target,{content:'+'}),content:''})),'+');
 assert.notEqual(reactionKey(unicode),'+');assert.equal(reactionKey(sign(reactionTemplate(target,{content:'-'}))),'-');
 assert.deepEqual(custom.tags.at(-1),['emoji','party','https://example.invalid/party.png']);
 for(const content of ['❤️','👨‍👩‍👧‍👦','🇯🇵','1️⃣','👍🏽'])assert.equal(reactionTemplate(target,{content}).content,content);
 for(const content of ['abc','++','🎉🎉','',':party:'])assert.throws(()=>reactionTemplate(target,{content}));
 for(const url of ['javascript:alert(1)','http://example.invalid/a.png','https://u:p@example.invalid/a.png'])assert.throws(()=>reactionTemplate(target,{content:':party:',emoji:{code:'party',url}}));
 assert.throws(()=>reactionTemplate(target,{content:':bad name:',emoji:{code:'bad name',url:'https://example.invalid/x.png'}}));
 // Cached verified symbols must not allow tampering; target uses the last e/p tags.
 assert(!reactionMatches({...like,content:'forged'},owner,target));
 assert(!reactionMatches({...like,sig:'0'.repeat(128)},owner,target));
 assert(!reactionMatches(like,otherOwner,target));
 assert(!reactionMatches(sign({...reactionTemplate(target,{content:'+'}),tags:[['e',target.id],['p',owner]]}),owner,target));
 assert(!reactionMatches(sign({...reactionTemplate(target,{content:'+'}),tags:[...like.tags,['e','a'.repeat(64)]]}),owner,target));
 assert(!reactionMatches(sign({...reactionTemplate(target,{content:'+'}),tags:[...like.tags,['k','6']]}),owner,target));
 assert(reactionMatches(sign({...reactionTemplate(target,{content:'+'}),tags:[['e','a'.repeat(64)],['p',owner],...like.tags]}),owner,target));
 const state=new ReactionState(owner);assert(state.receive(like,target));assert(!state.receive(like,target));state.receive(unicode,target);state.receive(custom,target);
 assert.equal(state.forTarget(target).length,3);
 const deletion=sign(deletionTemplate(owner,target,[like],5));assert.deepEqual(deletion.tags,[['e',like.id],['k','7']]);
 assert(!state.receive(finalizeEvent(deletionTemplate(owner,target,[like],5),other)));
 assert.throws(()=>deletionTemplate(otherOwner,target,[like]));
 state.receive(deletion);assert.equal(state.forTarget(target).length,2);
 const reversed=new ReactionState(owner);reversed.receive(deletion);reversed.receive(like,target);assert.equal(reversed.forTarget(target).length,0);
 // Reject/cancel/switch before publication, exact signed payload checking, duplicate lock.
 const writable=new ReactionState(owner),writer=new ReactionWriter(writable);let published=[];
 const args={target,choice:{content:'+'},signal:new AbortController().signal,currentOwner:()=>owner,sign:async e=>sign(e),publish:async e=>{published.push(e);return {confirmed:1,total:2}}};
 await assert.rejects(writer.send({...args,sign:async()=>{throw Error('User rejected')}}),/rejected/);assert.equal(published.length,0);
 await assert.rejects(writer.send({...args,sign:async e=>sign({...e,content:'-'})}),/一致/);
 const cancel=new AbortController();await assert.rejects(writer.send({...args,signal:cancel.signal,sign:async e=>{cancel.abort();return sign(e)}}),/中止/);
 let active=owner;await assert.rejects(writer.send({...args,currentOwner:()=>active,sign:async e=>{active=otherOwner;return sign(e)}}),/ログイン/);assert.equal(published.length,0);
 let release;const blocked=writer.send({...args,sign:e=>new Promise(resolve=>{release=()=>resolve(sign(e))})});await assert.rejects(writer.send(args),/送信中/);release();const partial=await blocked;assert.equal(partial.confirmed,1);assert.equal(partial.total,2);assert.equal(writable.forTarget(target).length,1);
 assert((await writer.send(args)).unchanged);assert.equal(published.length,1);
 // Uncertain retry uses the same event, no second signature or duplicate kind 7.
 const retryState=new ReactionState(owner),retryWriter=new ReactionWriter(retryState);let attempts=0,signatures=0,ids=[];
 const uncertain={...args,sign:async e=>{signatures++;return sign(e)},publish:async e=>{ids.push(e.id);return {confirmed:attempts++?1:0,total:2}}};
 assert.equal((await retryWriter.send(uncertain)).confirmed,0);assert.equal(retryState.forTarget(target).length,0);
 assert.equal((await retryWriter.send(uncertain)).confirmed,1);assert.equal(signatures,1);assert.equal(ids[0],ids[1]);
 const own=retryState.forTarget(target);await retryWriter.send({...args,choice:undefined,remove:own});assert.equal(retryState.forTarget(target).length,0);
 await retryWriter.send(args);assert.equal(retryState.forTarget(target).length,1);assert.notEqual(retryState.forTarget(target)[0].id,own[0].id);assert(retryState.forTarget(target)[0].created_at>own[0].created_at);
 // Concurrent event received during signing suppresses a redundant new event.
 const concurrentState=new ReactionState(owner),concurrent=new ReactionWriter(concurrentState);let sends=0;
 await concurrent.send({...args,sign:async e=>{concurrentState.receive(like,target);return sign(e)},publish:async()=>{sends++;return {confirmed:1,total:1}}});assert.equal(sends,0);
 // Fake sockets only. Initial fetch, exact deletion lookups, live changes, partial failure, reload and cleanup.
 class Socket{
  readyState=0;sent=[];constructor(url){this.url=url}
  send(raw){this.sent.push(JSON.parse(raw))}close(){this.readyState=3;this.closed=true}
  open(){this.readyState=1;this.onopen?.()}
  message(frame){this.onmessage?.({data:JSON.stringify(frame)})}
 }
 const sockets=[];const session=new ReactionSession(owner,['wss://a.invalid/','wss://b.invalid/'],url=>{const ws=new Socket(url);sockets.push(ws);return ws},100);
 const unwatch=session.watch(target,()=>{});session.start();sockets.forEach(s=>s.open());
 const request=(socket,kind)=>socket.sent.filter(f=>f[0]==='REQ'&&f[2].kinds[0]===kind&&f[2]['#e']).at(-1);
 let reaction=request(sockets[0],7);assert.deepEqual(reaction[2].authors,[owner]);assert.deepEqual(reaction[2]['#e'],[target.id]);
 sockets[0].message(['EVENT',reaction[1],like]);sockets[0].message(['EVENT',reaction[1],like]);
 let lookup=request(sockets[0],5);assert.deepEqual(lookup[2]['#e'],[like.id]);
 sockets[0].message(['EVENT',lookup[1],deletion]);sockets[0].message(['EOSE',lookup[1]]);sockets[0].message(['EOSE',reaction[1]]);
 sockets[1].onerror();assert.equal(session.snapshot(target.id).events.length,0);assert(session.snapshot(target.id).partial);assert(session.snapshot(target.id).available);
 // The surviving subscription receives another client's new emoji; kind 5 live removes it.
 sockets[0].message(['EVENT',reaction[1],unicode]);lookup=request(sockets[0],5);sockets[0].message(['EOSE',lookup[1]]);
 assert.equal(session.snapshot(target.id).events.length,1);
 const live=sockets[0].sent.find(f=>f[0]==='REQ'&&f[2].kinds[0]===5&&!f[2]['#e']);
 sockets[0].message(['EVENT',live[1],sign(deletionTemplate(owner,target,[unicode]))]);assert.equal(session.snapshot(target.id).events.length,0);
 assert(sockets.every(s=>s.sent.every(f=>f[0]!=='EVENT')));
 const stale=sockets[0].onmessage;session.stop();stale({data:JSON.stringify(['EVENT',reaction[1],custom])});assert(sockets.every(s=>s.closed));unwatch();
 const reloadSockets=[];const reload=new ReactionSession(owner,['wss://a.invalid/'],url=>{const s=new Socket(url);reloadSockets.push(s);return s});reload.watch(target,()=>{});reload.start();reloadSockets[0].open();reaction=request(reloadSockets[0],7);reloadSockets[0].message(['EVENT',reaction[1],custom]);lookup=request(reloadSockets[0],5);reloadSockets[0].message(['EOSE',lookup[1]]);reloadSockets[0].message(['EOSE',reaction[1]]);assert.equal(reload.snapshot(target.id).events[0].id,custom.id);reload.stop();
 const switched=new ReactionSession(otherOwner,[],()=>{throw Error('No sockets')});switched.watch(target,()=>{});switched.start();assert.equal(switched.state.forTarget(target).length,0);switched.stop();
 // Failed deletion lookup cannot be reported as a complete empty state; manual refresh recovers.
 const slowSockets=[];const slow=new ReactionSession(owner,['wss://slow.invalid/'],url=>{const s=new Socket(url);slowSockets.push(s);return s},5);
 slow.watch(target,()=>{});slow.start();slowSockets[0].open();let sr=request(slowSockets[0],7);slowSockets[0].message(['EVENT',sr[1],like]);slowSockets[0].message(['EOSE',sr[1]]);
 await new Promise(resolve=>setTimeout(resolve,10));assert(slow.snapshot(target.id).partial);assert(!slow.snapshot(target.id).loading);assert(!slow.snapshot(target.id).available);
 slow.refresh();sr=request(slowSockets[0],7);let sd=request(slowSockets[0],5);slowSockets[0].message(['EVENT',sd[1],deletion]);slowSockets[0].message(['EOSE',sd[1]]);slowSockets[0].message(['EOSE',sr[1]]);assert(!slow.snapshot(target.id).partial);assert(slow.snapshot(target.id).available);assert.equal(slow.snapshot(target.id).events.length,0);
 // Subscription denial and unknown subscription frames are ignored safely.
 slowSockets[0].message(['EVENT','unknown',custom]);assert.equal(slow.snapshot(target.id).events.length,0);slowSockets[0].message(['CLOSED',sr[1],'denied']);assert(slow.snapshot(target.id).partial);slow.stop();
 const afterState=new ReactionState(owner),afterWriter=new ReactionWriter(afterState);const afterAbort=new AbortController();let wasDispatched=false;
 await assert.rejects(afterWriter.send({...args,signal:afterAbort.signal,publish:async()=>{wasDispatched=true;afterAbort.abort();return {confirmed:1,total:1}}}),/中止/);assert(wasDispatched);assert.equal(afterState.forTarget(target).length,0);
 console.log('PASS reactions: NIP25/30/09, verification, last e/p/k, duplicate/delete ordering, account isolation, cancellation, refusal, signer tampering, concurrent update, partial ACK, same-ID retry, batched read-only subscriptions, live updates, reload and cleanup');
}finally{await fs.rm(dir,{recursive:true,force:true})}
