import fs from 'node:fs/promises';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(resolve('package.json')),ts=require('typescript'),{finalizeEvent}=require('nostr-tools');
const dir=process.env.THREAD_QA_DIR||'.sites-runtime';await fs.mkdir(dir,{recursive:true});const out=resolve(dir,'thread-test.mjs');
let source=await fs.readFile(process.env.THREAD_QA_SOURCE||'lib/thread-replies.ts','utf8');source=source.replace("'nostr-tools'",JSON.stringify(pathToFileURL(require.resolve('nostr-tools').replace('/cjs/','/esm/')).href));await fs.writeFile(out,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
try{
 const {replyParent,watchReplies}=await import(pathToFileURL(out));const root='1'.repeat(64),parent='2'.repeat(64),other='3'.repeat(64);
 assert.equal(replyParent([['e',root,'','root'],['e',parent,'','reply']]),parent);
 assert.equal(replyParent([['e',root,'','root']]),root);
 assert.equal(replyParent([['e',root],['e',parent]]),parent);
 assert.equal(replyParent([['e',root,'','mention']]),null);
 assert.equal(replyParent([['e',root,'','mention'],['e',parent]]),null);
 assert.equal(replyParent([['e',root,'','reply'],['e',parent,'','reply']]),null);
 const sk=new Uint8Array(32);sk[31]=1;const event=(tags,content='test')=>finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1000),tags,content},sk);
 const direct=event([['e',root,'','root']]),nested=event([['e',root,'','root'],['e',parent,'','reply']]),mention=event([['e',root,'','mention']]);
 class Socket{readyState=0;sent=[];closed=false;constructor(url){this.url=url}send(data){this.sent.push(JSON.parse(data))}close(){this.closed=true;this.readyState=3}open(){this.readyState=1;this.onopen?.()}emit(type,data){this.onmessage?.({data:JSON.stringify([type,this.sent[0][1],data])})}}
 const sockets=[],snapshots=[];const stop=watchReplies(root,['wss://ok.example','wss://bad.example','wss://ok.example'],s=>snapshots.push(s),{socket:url=>{const s=new Socket(url);sockets.push(s);return s},timeoutMs:100});
 sockets.forEach(s=>s.open());sockets[0].emit('EVENT',direct);sockets[0].emit('EVENT',direct);sockets[0].emit('EVENT',nested);sockets[0].emit('EVENT',mention);sockets[0].emit('EVENT',{...direct,id:other});sockets[1].onerror();sockets[0].emit('EOSE');
 assert.equal(snapshots.at(-1).events.length,1);assert.equal(snapshots.at(-1).complete,1);assert.equal(snapshots.at(-1).failed,1);assert.equal(snapshots.at(-1).loading,false);assert(sockets.every(s=>s.closed));stop();
 let last;const empty=[];watchReplies(root,['wss://empty.example'],s=>last=s,{socket:url=>{const s=new Socket(url);empty.push(s);return s}});empty[0].open();empty[0].emit('EOSE');assert.equal(last.complete,1);assert.equal(last.events.length,0);
 const hanging=[];watchReplies(root,['wss://timeout.example'],s=>last=s,{timeoutMs:5,socket:url=>{const s=new Socket(url);hanging.push(s);return s}});await new Promise(r=>setTimeout(r,15));assert.equal(last.failed,1);assert(hanging[0].closed);
 const cancelled=[];let calls=0;const cancel=watchReplies(root,['wss://cancel.example'],()=>calls++,{socket:url=>{const s=new Socket(url);cancelled.push(s);return s}});const old=calls;cancel();assert(cancelled[0].closed);assert.equal(cancelled[0].onmessage,null);assert.equal(calls,old);
 // A relay may deliver valid replies then fail before EOSE. Keep its data.
 const interrupted=[],partial=[];
 const stopInterrupted=watchReplies(root,['wss://interrupted.example'],s=>partial.push(s),{socket:url=>{const socket=new Socket(url);interrupted.push(socket);return socket}});
 interrupted[0].open();interrupted[0].emit('EVENT',direct);
 assert.equal(partial.at(-1).loading,true);assert.deepEqual(partial.at(-1).events.map(e=>e.id),[direct.id]);
 interrupted[0].onerror();assert.equal(partial.at(-1).complete,0);assert.equal(partial.at(-1).failed,1);assert.equal(partial.at(-1).loading,false);assert.deepEqual(partial.at(-1).events.map(e=>e.id),[direct.id]);stopInterrupted();
 // A healthy but slow relay remains active after another relay has failed.
 const delayed=[],delayedStates=[];const stopDelayed=watchReplies(root,['wss://broken.example','wss://slow.example'],s=>delayedStates.push(s),{timeoutMs:500,socket:url=>{const socket=new Socket(url);delayed.push(socket);return socket}});
 delayed[0].open();delayed[0].onerror();assert.equal(delayedStates.at(-1).loading,true);assert.equal(delayed[1].closed,false);
 await new Promise(r=>setTimeout(r,5));delayed[1].open();delayed[1].emit('EVENT',direct);assert.equal(delayedStates.at(-1).events.length,1);assert.equal(delayedStates.at(-1).loading,true);delayed[1].emit('EOSE');
 assert.equal(delayedStates.at(-1).complete,1);assert.equal(delayedStates.at(-1).failed,1);assert.equal(delayedStates.at(-1).loading,false);assert.equal(delayedStates.at(-1).events.length,1);stopDelayed();
 // Simulate an already queued socket callback after its timeout, not just a
 // detached onmessage property. Neither late EVENT nor late EOSE may mutate state.
 const expired=[],expiredStates=[];const stopExpired=watchReplies(root,['wss://expired.example'],s=>expiredStates.push(s),{timeoutMs:5,socket:url=>{const socket=new Socket(url);expired.push(socket);return socket}});
 expired[0].open();const stale=expired[0].onmessage,sub=expired[0].sent[0][1];await new Promise(r=>setTimeout(r,20));
 const settled=expiredStates.at(-1),count=expiredStates.length;assert.equal(settled.failed,1);assert.equal(settled.complete,0);assert.equal(settled.events.length,0);assert.equal(settled.loading,false);
 stale({data:JSON.stringify(['EVENT',sub,direct])});stale({data:JSON.stringify(['EOSE',sub])});assert.equal(expiredStates.length,count);assert.equal(expiredStates.at(-1),settled);stopExpired();
 // Successful empty EOSE and all failures are different terminal outcomes.
 const failures=[];let failedState;const stopFailures=watchReplies(root,['wss://fail-a.example','wss://fail-b.example'],s=>failedState=s,{socket:url=>{const socket=new Socket(url);failures.push(socket);return socket}});
 failures[0].onerror();failures[1].onclose();assert.deepEqual([failedState.complete,failedState.failed,failedState.loading,failedState.events.length],[0,2,false,0]);stopFailures();
 const emptySockets=[];let emptyState;const stopEmpty=watchReplies(root,['wss://successful-empty.example'],s=>emptyState=s,{socket:url=>{const socket=new Socket(url);emptySockets.push(socket);return socket}});
 emptySockets[0].open();emptySockets[0].emit('EOSE');assert.deepEqual([emptyState.complete,emptyState.failed,emptyState.loading,emptyState.events.length],[1,0,false,0]);stopEmpty();
 console.log('PASS replies: NIP10/verification/dedup; EVENT survives error; delayed healthy relay succeeds; late timeout callbacks ignored; all-failed differs from empty EOSE; cleanup');
}finally{await fs.rm(out)}
