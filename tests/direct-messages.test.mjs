import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {finalizeEvent,generateSecretKey,getPublicKey,getEventHash,nip44,verifyEvent} from 'nostr-tools';
await fs.mkdir('.sites-runtime/dm-tests',{recursive:true});
for(const name of ['relays','direct-messages','dm-relay','dm-session']){
 const source=(await fs.readFile(`lib/${name}.ts`,'utf8')).replace(/from '\.\/([^']+)'/g,"from './$1.mjs'");
 await fs.writeFile(`.sites-runtime/dm-tests/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const api=await import('../.sites-runtime/dm-tests/direct-messages.mjs');
const relay=await import('../.sites-runtime/dm-tests/dm-relay.mjs');
const session=await import('../.sites-runtime/dm-tests/dm-session.mjs');
const alice=generateSecretKey(),bob=generateSecretKey(),eve=generateSecretKey();
const owner=getPublicKey(alice),peer=getPublicKey(bob),outsider=getPublicKey(eve),now=Math.floor(Date.now()/1000);
function signer(key){return {getPublicKey:async()=>getPublicKey(key),signEvent:async event=>finalizeEvent(event,key),nip44:{encrypt:async(pub,text)=>nip44.v2.encrypt(text,nip44.v2.utils.getConversationKey(key,pub)),decrypt:async(pub,text)=>nip44.v2.decrypt(text,nip44.v2.utils.getConversationKey(key,pub))}}}
const a=signer(alice),b=signer(bob),signal=()=>new AbortController().signal;
const rumor=api.createRumor(owner,peer,'モックの秘密メッセージ');
const wrap=await api.wrapDm(rumor,peer,a,signal()),self=await api.wrapDm(rumor,owner,a,signal());
assert.equal(wrap.kind,1059);assert(verifyEvent(wrap));assert.notEqual(wrap.pubkey,owner);assert.notEqual(wrap.pubkey,self.pubkey);assert(!JSON.stringify(wrap).includes(rumor.content));assert(wrap.created_at<=now&&wrap.created_at>now-172800);
assert.deepEqual(await api.unwrapDm(wrap,peer,b,signal()),rumor);assert.deepEqual(await api.unwrapDm(self,owner,a,signal()),rumor);
assert.equal(api.mergeDms([rumor],[rumor,rumor]).length,1);
assert.equal(api.dmPeer(rumor,owner),peer);assert.equal(api.dmPeer(rumor,peer),owner);
const long=api.createRumor(owner,peer,'\u0001'.repeat(4000));assert.deepEqual(await api.unwrapDm(await api.wrapDm(long,peer,a,signal()),peer,b,signal()),long);
await assert.rejects(api.unwrapDm({...wrap,sig:'0'.repeat(128)},peer,b,signal()));
await assert.rejects(api.unwrapDm(wrap,outsider,signer(eve),signal()));
const abort=new AbortController();abort.abort();await assert.rejects(api.wrapDm(rumor,peer,a,abort.signal));
let decryptCalls=0;await assert.rejects(api.unwrapDm({...wrap,id:'f'.repeat(64)},peer,{...b,nip44:{decrypt:async()=>{decryptCalls++;return ''}}},signal()));assert.equal(decryptCalls,0);
async function custom(inner,{sealKey=alice,sealTags=[],badSig=false}={}){
 const seal=finalizeEvent({kind:13,created_at:now-100,tags:sealTags,content:await signer(sealKey).nip44.encrypt(peer,JSON.stringify(inner))},sealKey);
 if(badSig)seal.sig='0'.repeat(128);
 const key=generateSecretKey();return finalizeEvent({kind:1059,created_at:now-50,tags:[['p',peer]],content:await signer(key).nip44.encrypt(peer,JSON.stringify(seal))},key);
}
for(const bad of [{...rumor,pubkey:outsider},{...rumor,sig:'x'},{...rumor,id:'0'.repeat(64)},{...rumor,tags:[['p',outsider]]},{...rumor,tags:[['p',peer],['p',outsider]]},{...rumor,kind:15},{...rumor,created_at:now+3600}])await assert.rejects(api.unwrapDm(await custom(bad),peer,b,signal()));
await assert.rejects(api.unwrapDm(await custom(rumor,{sealTags:[['p',peer]]}),peer,b,signal()));await assert.rejects(api.unwrapDm(await custom(rumor,{badSig:true}),peer,b,signal()));
const old={...rumor,created_at:now-86400*365};old.id=getEventHash(old);assert.deepEqual(await api.unwrapDm(await custom(old),peer,b,signal()),old);
let release;const cancelling=new AbortController();const flight=api.wrapDm(rumor,peer,{...a,nip44:{...a.nip44,encrypt:()=>new Promise(r=>release=r)}},cancelling.signal);cancelling.abort();release(await a.nip44.encrypt(peer,JSON.stringify(rumor)));await assert.rejects(flight);
await assert.rejects(api.signDmEvent({...a,getPublicKey:async()=>peer},owner,{kind:22242,created_at:now,content:'',tags:[]},signal()));
await assert.rejects(api.signDmEvent({...a,signEvent:async e=>finalizeEvent({...e,content:'changed'},alice)},owner,{kind:22242,created_at:now,content:'',tags:[]},signal()));
const inboxA='wss://alice.example/',inboxB='wss://bob.example/',lookup='wss://directory.example/';
const list=(key,urls,time=now)=>finalizeEvent({kind:10050,created_at:time,content:'',tags:urls.map(u=>['relay',u])},key);
assert.deepEqual(api.dmRelayList([list(bob,[inboxB],now-1),list(bob,[])],peer),[]);
assert.deepEqual(api.dmRelayList([list(eve,[inboxA]),list(bob,['ws://bad.example','wss://127.0.0.1',inboxB])],peer),[inboxB]);
let scripts={},sockets=[],sent=[];
class Socket{
 readyState=0;authenticated=false;
 constructor(url){this.url=url;this.script=scripts[url]??{};sockets.push(this);queueMicrotask(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.();if(this.script.auth)this.emit(['AUTH','challenge'])})}
 emit(frame){this.onmessage?.({data:JSON.stringify(frame)})}
 send(raw){const frame=JSON.parse(raw);sent.push({url:this.url,frame});queueMicrotask(()=>{
  if(this.readyState===3)return;const s=this.script;
  if(frame[0]==='CLOSE')return;if(s.silent)return;if(s.fail){this.onerror?.();return}
  if(frame[0]==='AUTH'){assert.equal(frame[1].kind,22242);assert(verifyEvent(frame[1]));assert(frame[1].tags.some(t=>t[0]==='relay'&&t[1]===this.url));this.authenticated=true;this.emit(['OK',frame[1].id,true,'']);return}
  if(s.hint&&!this.authenticated&&frame[0]==='REQ'){this.emit(['AUTH','challenge']);this.emit(['EOSE',frame[1],['auth','finish']]);return}
  if(s.auth&&!this.authenticated){this.emit(frame[0]==='REQ'?['CLOSED',frame[1],'auth-required: test']:['OK',frame[1].id,false,'auth-required: test']);return}
  if(frame[0]==='REQ'){for(const e of s.events??[])this.emit(['EVENT',frame[1],e]);this.emit(['EOSE',frame[1]])}
  if(frame[0]==='EVENT'){this.emit(['OK','wrong-id',true,'']);this.emit(['OK',frame[1].id,!s.reject,'test'])}
 })}
 close(){this.readyState=3}
}
globalThis.WebSocket=Socket;
const ctx={owner,signer:a,signal:signal(),allowAuth:true,lookup:[lookup],timeout:50};
scripts[lookup]={events:[list(alice,[inboxA]),list(bob,[inboxB])]};scripts[inboxA]={auth:true};scripts[inboxB]={auth:true};
const pending=await session.prepareDm(peer,'test send',ctx);const receipt=await session.deliverDm(pending,ctx);assert.equal(receipt.recipient.confirmed,1);assert.equal(receipt.archive.confirmed,1);
const publications=sent.filter(s=>s.frame[0]==='EVENT');assert.equal(publications.length,4);assert(publications.every(s=>s.frame[1].kind===1059));assert(publications.every(s=>s.url===(s.frame[1].tags[0][1]===owner?inboxA:inboxB)));assert(!JSON.stringify(sent).includes('test send'));
scripts[inboxB]={reject:true};const partial=await session.deliverDm(pending,ctx);assert.equal(partial.recipient.confirmed,0);assert.equal(partial.archive.confirmed,1);assert(sent.filter(s=>s.url===inboxB&&s.frame[0]==='EVENT').every(s=>s.frame[1].id===pending.recipient.id));
scripts[inboxB]={auth:true};let r=await relay.dmRelay(inboxB,wrap,{...ctx,allowAuth:false});assert.equal(r.ok,false);
scripts[lookup]={events:[list(alice,[inboxA])]};const count=sent.filter(s=>s.frame[0]==='EVENT').length;await assert.rejects(session.prepareDm(peer,'do not send',ctx),/未設定/);assert.equal(sent.filter(s=>s.frame[0]==='EVENT').length,count);
scripts[lookup]={fail:true};await assert.rejects(session.resolveDmRelays(peer,ctx),/確認できません/);
scripts[inboxA]={events:[self,self,wrap,{...self,sig:'bad'}]};r=await relay.dmRelay(inboxA,{kinds:[1059],'#p':[owner],limit:100},ctx);assert.equal(r.events.length,1);assert(r.ok);
scripts[inboxA]={hint:true,events:[self]};r=await relay.dmRelay(inboxA,{kinds:[1059],'#p':[owner]},ctx);assert(r.ok);assert.equal(r.events.length,1);
scripts[inboxA]={silent:true};const cancelled=new AbortController();const result=relay.dmRelay(inboxA,wrap,{...ctx,signal:cancelled.signal});cancelled.abort();assert.equal((await result).ok,false);assert(sockets.every(s=>s.readyState===3));
r=await relay.dmRelay(inboxA,wrap,{...ctx,timeout:5});assert.equal(r.ok,false);
let releaseKey,lateSigns=0;scripts[inboxA]={auth:true};const slow=relay.dmRelay(inboxA,wrap,{...ctx,timeout:5,signer:{...a,getPublicKey:()=>new Promise(r=>releaseKey=r),signEvent:async e=>{lateSigns++;return a.signEvent(e)}}});await slow;releaseKey(owner);await new Promise(r=>setTimeout(r,0));assert.equal(lateSigns,0);
console.log('DM: crypto roundtrip, adversarial envelopes, history, deduplication, revocation, isolated delivery, AUTH, partial failure, retries and cancellation passed');
