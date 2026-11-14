import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {finalizeEvent,getPublicKey} from 'nostr-tools';
const require=createRequire(import.meta.url),dir=path.resolve('.sites-runtime/nip05-tests');await fs.mkdir(dir,{recursive:true});
for(const file of ['nip05','nip05-profile','profiles','custom-emoji','note-media']){
 let source=await fs.readFile(`lib/${file}.ts`,'utf8');source=source.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'").replace("'nostr-tools'",JSON.stringify(pathToFileURL(require.resolve('nostr-tools').replace('/cjs/','/esm/')).href));
 await fs.writeFile(path.join(dir,file+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const original=globalThis.WebSocket;
try {
 const {findNip05Profile}=await import(pathToFileURL(path.join(dir,'nip05-profile.mjs')));
 const sk=new Uint8Array(32);sk[31]=2;const pubkey=getPublicKey(sk);
 const event=(time,nip05='alice@example.com',extra={})=>finalizeEvent({kind:0,created_at:time,tags:[],content:JSON.stringify({name:'Alice',nip05,...extra})},sk);
 const older=event(1),newer=event(2);let scripts={},sockets=[],frames=[];
 class Socket {readyState=0;constructor(url){this.url=url;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.()})}send(raw){const frame=JSON.parse(raw);frames.push(frame);if(frame[0]!=='REQ')return;assert.deepEqual(frame[2],{authors:[pubkey],kinds:[0],limit:10});queueMicrotask(()=>{const script=scripts[this.url];if(script==='fail'){this.onerror?.();return}if(script==='hang')return;for(const ev of script||[])this.onmessage?.({data:JSON.stringify(['EVENT',frame[1],ev])});this.onmessage?.({data:JSON.stringify(['EOSE',frame[1]])})})}close(){this.readyState=3}}
 globalThis.WebSocket=Socket;
 const resolver={resolve:async()=>({status:'resolved',pubkey})};const a='wss://a.example',b='wss://b.example';const lookup=(signal=new AbortController().signal)=>findNip05Profile('alice@example.com',[a,b],signal,resolver,10);
 scripts={[a]:[older],[b]:[newer]};let result=await lookup();assert.equal(result.status,'found');assert.equal(result.profile.eventId,newer.id);assert.equal(result.partial,false);
 scripts={[a]:[newer],[b]:'fail'};result=await lookup();assert.equal(result.status,'found');assert.equal(result.partial,true);assert.equal(result.pubkey,pubkey);
 scripts={[a]:[newer],[b]:'hang'};assert.equal((await lookup()).partial,true);
 scripts={[a]:[older],[b]:[event(3,'other@example.com')]};assert.equal((await lookup()).status,'unconfirmed');
 scripts={[a]:[older],[b]:[finalizeEvent({kind:0,created_at:3,tags:[],content:'bad json'},sk)]};assert.equal((await lookup()).status,'unconfirmed');
 const tie1=event(9),tie2=event(9,'other@example.com');scripts={[a]:[tie1],[b]:[tie2]};assert.equal((await lookup()).status,tie1.id<tie2.id?'found':'unconfirmed');
 scripts={[a]:[{...newer,content:JSON.stringify({nip05:'alice@example.com'})}],[b]:[{...newer,sig:'0'.repeat(128)}]};assert.equal((await lookup()).status,'unconfirmed');
 scripts={[a]:'fail',[b]:'fail'};assert.equal((await lookup()).status,'unconfirmed');
 scripts={[a]:'hang',[b]:'hang'};const controller=new AbortController();const pending=lookup(controller.signal);await new Promise(resolve=>setTimeout(resolve,0));controller.abort();assert.equal((await pending).status,'cancelled');
 const count=sockets.length;assert.equal((await lookup(controller.signal)).status,'cancelled');assert.equal(sockets.length,count);assert(sockets.every(s=>s.readyState===3));assert(frames.every(f=>['REQ','CLOSE'].includes(f[0])));
 assert.equal((await findNip05Profile('alice@example.com',[],new AbortController().signal,resolver)).status,'unconfirmed');
 console.log('PASS NIP-05 discovery: signed metadata back-reference, newest/tie, malformed newest, tampered signatures, partial failures/timeouts, cleanup/cancel, configured relays and read-only frames');
} finally {globalThis.WebSocket=original;await fs.rm(dir,{recursive:true,force:true});}
