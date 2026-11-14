import fs from 'node:fs/promises';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {finalizeEvent,generateSecretKey,verifyEvent} from 'nostr-tools';
const path=resolve('.sites-runtime/deletions-test.mjs');
await fs.writeFile(path,ts.transpileModule(await fs.readFile('lib/deletions.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
try{
 const {DeletionTracker,deletionPayload,sendDeletion}=await import(pathToFileURL(path));
 const key=generateSecretKey(),other=generateSecretKey();
 const make=(kind=1,secret=key,tags=[],content='fixture')=>finalizeEvent({kind,created_at:1,tags,content},secret);
 const note=make(),repost=make(6,key,[['e',note.id]]),foreign=make(1,other);
 const deletion=(target,secret=key,tags=[['e',target.id]])=>make(5,secret,tags,'');
 class Socket{url;readyState=1;sent=[];constructor(url){this.url=url}send(frame){this.sent.push(JSON.parse(frame))}}
 const read=new Socket('wss://read.example'),write=new Socket('wss://write.example');
 const tracker=new DeletionTracker(()=>[read,write],()=>[read.url]);
 let updates=0;const unsubscribe=tracker.subscribe(()=>updates++);
 const unwatch=tracker.watch(note),unwatchRepost=tracker.watch(repost),unwatchForeign=tracker.watch(foreign);
 tracker.refresh();assert.equal(write.sent.length,0);
 let req=read.sent.at(-1);assert.deepEqual(req[2]['#e'],[note.id,repost.id,foreign.id]);assert.deepEqual(req[2].kinds,[5]);
 tracker.receive(read,['EOSE',req[1]]);assert.equal(read.sent.at(-1)[0],'REQ');
 assert.equal(tracker.accept(deletion(note,other)),false);
 const tampered={...deletion(note),sig:'0'.repeat(128)};
 assert.equal(tracker.accept(tampered),false);assert.equal(tracker.isDeleted(note),false);
 // Even a valid cached nostr-tools object must not allow a later mutation.
 const cached=deletion(note);assert(verifyEvent(cached));cached.tags=[['e',foreign.id]];cached.pubkey=foreign.pubkey;
 assert.equal(tracker.accept(cached),false);
 // Unknown subscriptions and write-only sockets cannot introduce deletion events.
 tracker.receive(write,['EVENT',req[1],deletion(note)]);tracker.receive(read,['EVENT','deletion-stale',deletion(note)]);assert.equal(tracker.isDeleted(note),false);
 tracker.receive(read,['EVENT',req[1],deletion(repost)]);
 assert.equal(tracker.isDeleted(repost),true);assert.equal(tracker.isDeleted(note),false);
 // k is a SHOULD, so valid incoming requests without k are accepted.
 tracker.receive(read,['EVENT',req[1],deletion(note,key,[['e',note.id],['e',foreign.id]])]);
 assert.equal(tracker.isDeleted(note),true);assert.equal(tracker.isDeleted(foreign),false);assert.equal(updates,2);
 tracker.accept(deletion(note));assert.equal(updates,2);
 tracker.refresh();assert(read.sent.some(f=>f[0]==='CLOSE'&&f[1]===req[1]));assert.notEqual(read.sent.at(-1)[1],req[1]);
 // Repeated references retain the subscription until the last reference disappears.
 const second=tracker.watch(note);unwatch();tracker.refresh();assert(read.sent.at(-1)[2]['#e'].includes(note.id));second();unwatchRepost();unwatchForeign();tracker.refresh();assert.equal(read.sent.at(-1)[0],'CLOSE');
 // Retained tombstones cover cached/replayed events after remount.
 const again=tracker.watch(note);assert.equal(tracker.isDeleted(note),true);again();unsubscribe();tracker.stop();
 const broken=new Socket('wss://broken.example');broken.send=()=>{throw Error('offline')};
 const resilient=new DeletionTracker(()=>[broken,read],()=>[broken.url,read.url]);const stopWatch=resilient.watch(foreign);resilient.refresh();
 const active=read.sent.at(-1)[1];resilient.receive(read,['EVENT',active,deletion(foreign,other)]);assert(resilient.isDeleted(foreign));
 stopWatch();resilient.stop();const fresh=resilient.watch(note);resilient.refresh();const stale=read.sent.at(-1)[1];resilient.stop();resilient.receive(read,['EVENT',stale,deletion(note)]);assert.equal(resilient.isDeleted(note),false);fresh();resilient.stop();
 const bounded=new DeletionTracker(()=>[read],()=>[read.url],1);const releaseNote=bounded.watch(note),releaseRepost=bounded.watch(repost);
 bounded.accept(deletion(note));bounded.accept(deletion(repost));assert(bounded.isDeleted(note));assert(bounded.isDeleted(repost));
 releaseNote();assert.equal(bounded.isDeleted(note),false);assert(bounded.isDeleted(repost));
 const remount=bounded.watch(note);bounded.refresh();bounded.receive(read,['EVENT',read.sent.at(-1)[1],deletion(note)]);assert(bounded.isDeleted(note));assert(bounded.isDeleted(repost));
 remount();releaseRepost();bounded.stop();
 assert.deepEqual(deletionPayload(note,note.pubkey).tags,[['e',note.id],['k','1']]);
 assert.deepEqual(deletionPayload(repost,repost.pubkey).tags,[['e',repost.id],['k','6']]);
 assert.throws(()=>deletionPayload(note,foreign.pubkey));assert.throws(()=>deletionPayload(make(5),note.pubkey));
 assert.throws(()=>deletionPayload({...note,content:'tampered'},note.pubkey));
 let owner=note.pubkey,sent=[];
 const base={target:note,owner:note.pubkey,currentOwner:()=>owner,signal:new AbortController().signal,sign:async e=>finalizeEvent(e,key),publish:async e=>{sent.push(e);return {confirmed:1,total:2}}};
 const receipt=await sendDeletion(base);assert.equal(receipt.confirmed,1);assert.equal(receipt.total,2);assert.equal(sent.length,1);assert.equal(sent[0].kind,5);
 for(const sign of [async e=>finalizeEvent(e,other),async e=>finalizeEvent({...e,tags:[]},key),async e=>{e.content='mutation';return finalizeEvent(e,key)},async()=>{throw Error('rejected')}])await assert.rejects(sendDeletion({...base,sign}));
 assert.equal(sent.length,1);
 const abort=new AbortController();await assert.rejects(sendDeletion({...base,signal:abort.signal,sign:async e=>{abort.abort();return finalizeEvent(e,key)}}));assert.equal(sent.length,1);
 await assert.rejects(sendDeletion({...base,sign:async e=>{owner=foreign.pubkey;return finalizeEvent(e,key)}}));assert.equal(sent.length,1);owner=note.pubkey;
 const none=await sendDeletion({...base,publish:async()=>({confirmed:0,total:2})});assert.equal(none.confirmed,0);
 console.log('PASS NIP-09: verified authors and signatures, repost independence, subscription scope/reconnect/cleanup, replay, e/k tags, signer mutation/rejection, cancel/account switch, partial/unconfirmed delivery');
}finally{await fs.rm(path)}
