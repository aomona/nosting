import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {finalizeEvent, generateSecretKey, getPublicKey, verifyEvent} from 'nostr-tools';
await fs.mkdir('.sites-runtime', {recursive:true});
const dir=await fs.mkdtemp(resolve('.sites-runtime/relay-auth-'));
try {
 for(const name of ['relay-auth','relay-connections']) {
  const source=ts.transpileModule(await fs.readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
  await fs.writeFile(`${dir}/${name}.mjs`,source);
 }
 const {RelayConnections,RelayPublisher}=await import(pathToFileURL(`${dir}/relay-connections.mjs`));
 const {RelayAuthentication}=await import(pathToFileURL(`${dir}/relay-auth.mjs`));
 const key=generateSecretKey(),owner=getPublicKey(key),otherKey=generateSecretKey(),url='wss://auth.example/',good='wss://healthy.example/';
 const sign=async u=>finalizeEvent(u,key),tick=()=>new Promise(r=>setTimeout(r,0));
 const request=(extra={})=>({owner,currentOwner:()=>owner,sign,signal:new AbortController().signal,...extra});
 class Socket {
  readyState=0;sent=[];
  constructor(url){this.url=url;}
  send(raw){const frame=JSON.parse(raw);this.sent.push(frame);this.afterSend?.(frame);}
  open(){this.readyState=1;this.onopen?.({});}
  close(){this.readyState=3;this.onclose?.({});}
  receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}
 }
 function setup(config=[{url,read:true,write:true}]) {
  const sockets=[],states={},received=[],publisher=new RelayPublisher();
  const manager=new RelayConnections({status:()=>{},changed:()=>{},open:()=>{},disconnected:()=>{},authChanged:(url,state)=>states[url]=state,message:(ws,c,e,frame)=>{received.push(frame);if(frame[0]==='OK')publisher.receive(ws.url,frame[1],frame[2]);}},url=>{const ws=new Socket(url);sockets.push(ws);return ws;},[],1000);
  manager.start(config);sockets.forEach(ws=>ws.open());
  return {manager,sockets,states,received,publisher,ws:sockets[0],stop:()=>{publisher.cancel();manager.stop();}};
 }
 const authEvent=ws=>ws.sent.findLast(m=>m[0]==='AUTH')?.[1];
 const challenge=(ws,value='challenge')=>ws.receive(['AUTH',value]);
 const accepted=ws=>ws.receive(['OK',authEvent(ws).id,true,'']);
 // Explicit consent, exact event shape/crypto, one replay, no EVENT publication of auth.
 {
  const s=setup(),{ws,manager,states}=s;let signatures=0;
  challenge(ws);ws.send(JSON.stringify(['REQ','feed',{kinds:[1]}]));ws.receive(['CLOSED','feed','auth-required: login']);
  assert.equal(states[url].status,'required');assert.equal(ws.sent.length,1);assert.equal(s.received.length,0);
  await manager.authenticate(url,request({sign:async u=>{signatures++;return sign(u);}}));
  const event=authEvent(ws);assert.equal(event.kind,22242);assert.equal(event.content,'');assert.deepEqual(event.tags,[['relay',url],['challenge','challenge']]);assert(verifyEvent(event));
  assert.equal(ws.sent.filter(m=>m[0]==='REQ').length,1);ws.receive(['OK',event.id,'true','']);assert.equal(states[url].status,'waiting');
  accepted(ws);assert.equal(ws.sent.filter(m=>m[0]==='REQ').length,2);assert.equal(states[url].status,'authenticated');
  ws.receive(['CLOSED','feed','auth-required: again']);assert.equal(ws.sent.length,3);assert.equal(states[url].status,'exhausted');assert.equal(s.received.at(-1)[0],'CLOSED');
  challenge(ws);await manager.authenticate(url,request());assert.equal(signatures,1);
  assert.throws(()=>ws.send(JSON.stringify(['EVENT',event])),/consent/);assert.throws(()=>ws.send(JSON.stringify(['AUTH',event])),/consent/);s.stop();
 }
 // Authenticated OK may precede the rejection; CLOSE cancels queued subscriptions.
 {
  const s=setup();challenge(s.ws);s.ws.send(JSON.stringify(['REQ','cancelled',{}]));s.ws.receive(['CLOSED','cancelled','auth-required:']);s.ws.send(JSON.stringify(['CLOSE','cancelled']));
  await s.manager.authenticate(url,request());accepted(s.ws);assert.equal(s.ws.sent.filter(m=>m[0]==='REQ').length,1);
  s.ws.send(JSON.stringify(['REQ','late',{}]));s.ws.receive(['CLOSED','late','auth-required:']);assert.equal(s.ws.sent.filter(m=>m[1]==='late').length,2);s.stop();
 }
 // Auth OK cannot settle publication, and write retry is ACKed separately.
 {
  const s=setup();challenge(s.ws);const ev=finalizeEvent({kind:1,created_at:1,content:'local mock',tags:[]},key);let result;
  const pending=s.publisher.publish([s.ws],ev).then(r=>result=r);s.ws.receive(['OK',ev.id,false,'auth-required: login']);
  await s.manager.authenticate(url,request());accepted(s.ws);await tick();assert.equal(result,undefined);assert.equal(s.ws.sent.filter(m=>m[0]==='EVENT').length,2);
  s.ws.receive(['OK',ev.id,true,'']);await pending;assert.equal(result.confirmed,1);s.stop();
 }
 // A healthy relay wins immediately; finished/cancelled/timed-out writes never replay later.
 for(const mode of ['healthy','cancel','timeout']) {
  const s=setup([{url,read:true,write:true},{url:good,read:true,write:true}]);challenge(s.ws);
  const ev=finalizeEvent({kind:1,created_at:1,content:mode,tags:[]},key);
  const pending=s.publisher.publish(s.sockets,ev,mode==='timeout'?5:1000);s.ws.receive(['OK',ev.id,false,'auth-required:']);
  if(mode==='healthy')s.sockets[1].receive(['OK',ev.id,true,'']);if(mode==='cancel')s.publisher.cancel();
  const result=await pending;assert.equal(result.accepted,mode==='healthy');await s.manager.authenticate(url,request());accepted(s.ws);assert.equal(s.ws.sent.filter(m=>m[0]==='EVENT').length,1);s.stop();
 }
 // restricted never prompts/retries, signature rejection unblocks callers without loops.
 for(const mode of ['restricted','denied','bad-signature','wrong-owner','mutated-template','wrong-template']) {
  const s=setup();challenge(s.ws);s.ws.send(JSON.stringify(['REQ','q',{}]));s.ws.receive(['CLOSED','q',mode==='restricted'?'restricted: payment':'auth-required:']);
  if(mode==='restricted'){assert.equal(s.states[url].status,'restricted');assert.equal(s.received.length,1);s.stop();continue;}
  await s.manager.authenticate(url,request({sign:async u=>{
   if(mode==='denied')throw Error('user denied');
   if(mode==='wrong-owner')return finalizeEvent(u,otherKey);
   if(mode==='mutated-template'){u.tags[0][1]='wss://evil.example/';return finalizeEvent(u,key);}
   if(mode==='wrong-template')return finalizeEvent({...u,content:'changed'},key);
   const signed=finalizeEvent(u,key);signed.sig='0'.repeat(128);return signed; // cached verified symbol must not bypass verification
  }}));
  assert.equal(authEvent(s.ws),undefined);assert.equal(s.states[url].status,mode==='denied'?'signing-rejected':'invalid');assert.equal(s.received.at(-1)[0],'CLOSED');s.stop();
 }
 // Challenge replacement while signing or awaiting OK invalidates old result/ACK.
 for(const phase of ['signing','waiting']) {
  const s=setup();challenge(s.ws,'old');let resolveSign;let template;
  const pending=s.manager.authenticate(url,request({sign:u=>{template=u;return new Promise(r=>resolveSign=r);}}));
  if(phase==='waiting'){resolveSign(finalizeEvent(template,key));await pending;}
  const old=authEvent(s.ws);challenge(s.ws,'new');assert.equal(s.states[url].status,'stale');
  if(phase==='signing'){resolveSign(finalizeEvent(template,key));await pending;assert.equal(authEvent(s.ws),undefined);}
  else{s.ws.receive(['OK',old.id,true,'']);assert.equal(s.states[url].status,'stale');}
  await s.manager.authenticate(url,request());assert.equal(authEvent(s.ws).tags[1][1],'new');accepted(s.ws);assert.equal(s.states[url].status,'authenticated');s.stop();
 }
 // Cancellation and account switch at both asynchronous boundaries, including late signer completion.
 for(const phase of ['signing','waiting'])for(const action of ['abort','account','stop']) {
  const s=setup();challenge(s.ws);s.ws.send(JSON.stringify(['REQ','q',{}]));s.ws.receive(['CLOSED','q','auth-required:']);
  let current=owner,resolveSign,template;const controller=new AbortController();
  const pending=s.manager.authenticate(url,request({currentOwner:()=>current,signal:controller.signal,sign:u=>{template=u;return new Promise(r=>resolveSign=r);}}));
  if(phase==='waiting'){resolveSign(finalizeEvent(template,key));await pending;}
  if(action==='abort')controller.abort();if(action==='account')current=getPublicKey(otherKey);if(action==='stop')s.manager.stop();
  if(phase==='signing'){resolveSign(finalizeEvent(template,key));await pending;}else accepted(s.ws);
  assert.equal(s.ws.sent.filter(m=>m[0]==='REQ').length,1);if(action!=='stop')assert.equal(s.states[url].status,action==='abort'?'cancelled':'account-changed');s.stop();
 }
 // Socket replacement discards challenge, identity and old callbacks. Per-connection signing budget is bounded.
 {
  const s=setup();challenge(s.ws);await s.manager.authenticate(url,request());accepted(s.ws);const staleMessage=s.ws.onmessage;
  s.manager.start([{url,read:true,write:false}]);const fresh=s.sockets.at(-1);fresh.open();assert.equal(s.states[url],undefined);await s.manager.authenticate(url,request());assert.equal(fresh.sent.length,0);
  staleMessage({data:JSON.stringify(['AUTH','stale'])});assert.equal(s.states[url],undefined);
  for(let i=0;i<5;i++){challenge(fresh,String(i));await s.manager.authenticate(url,request());if(i<3)accepted(fresh);}
  assert.equal(fresh.sent.filter(m=>m[0]==='AUTH').length,3);assert.equal(s.states[url].status,'exhausted');s.stop();
 }
 // A relay rejects AUTH itself; no subscription/write replay or automatic signing follows.
 for(const reason of ['restricted: not allowed','error: rejected']) {
  const s=setup();challenge(s.ws);s.ws.send(JSON.stringify(['REQ','q',{}]));s.ws.receive(['CLOSED','q','auth-required:']);
  await s.manager.authenticate(url,request());s.ws.receive(['OK',authEvent(s.ws).id,false,reason]);
  assert.equal(s.states[url].status,reason.startsWith('restricted:')?'restricted':'rejected');assert.equal(s.states[url].canAuthenticate,false);
  assert.equal(s.ws.sent.filter(m=>m[0]==='REQ').length,1);assert.equal(s.received.at(-1)[0],'CLOSED');s.stop();
 }
 // Actual failed-socket reconnect discards challenge and pending signer result.
 {
  const s=setup();challenge(s.ws);let done,template;const pending=s.manager.authenticate(url,request({sign:u=>{template=u;return new Promise(r=>done=r);}}));
  s.ws.onerror({});assert.equal(s.states[url],undefined);assert.equal(s.manager.restart(url),true);const fresh=s.sockets.at(-1);fresh.open();
  done(finalizeEvent(template,key));await pending;assert.equal(fresh.sent.length,0);assert.equal(authEvent(s.ws),undefined);
  await s.manager.authenticate(url,request());assert.equal(fresh.sent.length,0);challenge(fresh);await s.manager.authenticate(url,request());accepted(fresh);s.stop();
 }
 // Read-only and write-only connections both allow AUTH independently of EVENT permission.
 for(const read of [true,false]){const s=setup([{url,read,write:!read}]);challenge(s.ws);await s.manager.authenticate(url,request());assert(authEvent(s.ws));s.stop();}
 // Signature and relay ACK deadlines are bounded; direct writes and malformed challenges are bounded too.
 {
  const sent=[],states=[],terminal=[];const auth=new RelayAuthentication(url,m=>sent.push(m),m=>terminal.push(m),s=>states.push(s),5);
  auth.receive(['AUTH','']);auth.receive(['AUTH','x'.repeat(257)]);await auth.authenticate(request());assert.equal(sent.length,0);
  auth.receive(['AUTH','timeout']);auth.outgoing(['REQ','q',{}]);auth.receive(['CLOSED','q','auth-required:']);
  let resolveSign,template;const pending=auth.authenticate(request({sign:u=>{template=u;return new Promise(r=>resolveSign=r);}}));
  await new Promise(r=>setTimeout(r,15));resolveSign(finalizeEvent(template,key));await pending;assert.equal(states.at(-1).status,'timeout');assert.equal(sent.length,0);assert.equal(terminal.length,1);auth.dispose();
 }
 console.log('PASS NIP-42 consent, exact signature, AUTH/OK/CLOSED flow, retry limits, restricted/rejection, stale challenge/ACK, account switch, cancellation/timeout, socket reset, partial publish and no late writes');
} finally {await fs.rm(dir,{recursive:true,force:true});}
