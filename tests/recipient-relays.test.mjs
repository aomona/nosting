import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as nostr from 'nostr-tools';

const modules=new Map();
let scripts={},instances=[],active=0,peak=0;
class Socket {
  readyState=0; frames=[];
  constructor(url){this.url=url;instances.push(this);active++;peak=Math.max(peak,active);if(scripts[url]?.connect!==false)queueMicrotask(()=>this.open());}
  open(){if(this.readyState===3)return;this.readyState=1;this.onopen?.();}
  send(raw){const frame=JSON.parse(raw);this.frames.push(frame);if(frame[0]==='CLOSE')return;
    queueMicrotask(()=>{
      if(this.readyState===3)return;
      const script=scripts[this.url]??{};
      if(script.fail){this.onerror?.();return;}
      if(frame[0]==='REQ'){
        for(const event of script.events??[])this.receive(['EVENT',frame[1],event]);
        if(script.closed)this.receive(['CLOSED',frame[1],'blocked']);
        else if(!script.silent)this.receive(['EOSE',frame[1]]);
      }else if(frame[0]==='EVENT'){
        this.receive(['OK','unrelated',true,'']);
        const ack=frame[1].kind===10002?script.metadata:script.note;
        if(typeof ack==='boolean')this.receive(['OK',frame[1].id,ack,'']);
        script.afterSend?.(frame[1]);
      }
    });
  }
  receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}
  close(){if(this.readyState!==3)active--;this.readyState=3;}
}
async function load(name){
  if(modules.has(name))return modules.get(name);
  const source=await fs.readFile(`lib/${name}.ts`,'utf8'),deps={'nostr-tools':{...nostr,verifyEvent:event=>nostr.verifyEvent(JSON.parse(JSON.stringify(event)))}};
  for(const match of source.matchAll(/from '\.\/([^']+)'/g))deps[`./${match[1]}`]=await load(match[1]);
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],URL,TextEncoder,setTimeout,clearTimeout,AbortController,AbortSignal,WebSocket:Socket,console});
  modules.set(name,exports);return exports;
}
const api=await load('recipient-relays');
const sk=new Uint8Array(32);sk[31]=1;const otherSk=new Uint8Array(32);otherSk[31]=2;
const owner=nostr.getPublicKey(sk),other=nostr.getPublicKey(otherSk),now=Math.floor(Date.now()/1000);
const a='wss://sender.example/',b='wss://inbox.example/',c='wss://index.example/',d='wss://outbox.example/';
const list=(secret,tags,time=now-10)=>nostr.finalizeEvent({kind:10002,created_at:time,content:'',tags},secret);
const own=list(sk,[['r',a,'write']]),old=list(otherSk,[['r',d,'read']],now-20),recipient=list(otherSk,[['r',b,'read'],['r',d,'write']]);
const plain=x=>JSON.parse(JSON.stringify(x));
const signal=()=>new AbortController().signal;
const unsigned={kind:1,content:'A reply',tags:[['p',other],['p',other],['p',owner]],created_at:now};
const args={owner,unsigned,ownList:own,writeUrls:[a],lookupUrls:[a,c],signal:signal(),currentOwner:()=>owner,sign:async event=>nostr.finalizeEvent(plain(event),sk),timeout:10};
function reset(value){assert.equal(active,0);scripts=value;instances=[];peak=0;}
reset({[a]:{events:[own,old],note:true,metadata:true},[c]:{events:[recipient]},[b]:{note:true,metadata:true}});
const inputCopy=JSON.stringify(args.writeUrls);let result=await api.publishRecipientNote(args);
assert.deepEqual(plain(result.targets),[a,b]);assert.equal(result.missing,0);assert(!result.limited);assert(!result.discoveryPartial);assert(!result.metadataMissing);
assert.equal(result.receipts.filter(r=>r.note&&r.metadata).length,2);assert.equal(JSON.stringify(args.writeUrls),inputCopy);
assert(!instances.some(s=>s.url===d));assert(instances.every(s=>s.readyState===3));
for(const url of [a,b]){const publications=instances.filter(s=>s.url===url).flatMap(s=>s.frames.filter(f=>f[0]==='EVENT'));assert.deepEqual(publications.map(f=>f[1].kind),[10002,1]);assert.equal(publications[0][1].id,own.id);}
assert.equal(api.recipientPublicationMessage(result),'2/2リレーで投稿を確認');

// Latest signed event across queried relays; NIP-01 tie-break, no fallback to old inboxes.
const tie=list(otherSk,[['r',d]],recipient.created_at);
reset({[a]:{events:[recipient]},[c]:{events:[tie]}});
let discovery=await api.discoverRecipientRelays([other],[a,c],signal(),10);
assert.equal(discovery.events.get(other).id,[tie.id,recipient.id].sort()[0]);
reset({[a]:{events:[old]},[c]:{events:[list(otherSk,[])]}});
discovery=await api.discoverRecipientRelays([other],[a,c],signal(),10);
assert.equal(api.planRecipientDelivery([a],[other],discovery.events).targets.length,1);
for(const bad of [{...recipient,content:'tampered'},{...recipient,sig:'0'.repeat(128)},own,list(otherSk,[],now+10000)]){
 reset({[a]:{events:[bad]}});discovery=await api.discoverRecipientRelays([other],[a],signal(),10);assert.equal(discovery.events.size,0);assert(discovery.partial);
}
for(const failure of [{silent:true},{fail:true},{closed:true},{connect:false}]){
 reset({[a]:{events:[recipient]},[c]:failure});discovery=await api.discoverRecipientRelays([other],[a,c],signal(),2);assert(discovery.partial);assert.equal(discovery.events.get(other).id,recipient.id);
}
reset({[a]:{events:Array(257).fill(recipient)}});discovery=await api.discoverRecipientRelays([other],[a],signal(),10);assert(discovery.partial);
reset({});result=await api.publishRecipientNote({...args,ownList:null});assert.equal(result.missing,1);assert(result.metadataMissing);assert.equal(result.receipts.filter(r=>r.note).length,0);
assert.match(api.recipientPublicationMessage(result),/再投稿前/);
reset({[a]:{events:[own],note:true,metadata:false},[c]:{fail:true}});result=await api.publishRecipientNote(args);assert.equal(result.missing,1);assert(result.discoveryPartial);assert.match(api.recipientPublicationMessage(result),/未発見 1人.*一部未確認.*共有は一部未確認/);

// Unsafe URL forms and hints never create a connection.
for(const value of ['ws://public.example','https://public.example','public.example','wss://localhost','wss://foo.local','wss://foo.local.','wss://foo.internal','wss://foo.lan','wss://router.home.arpa','wss://127.0.0.1','wss://127.1','wss://2130706433','wss://0x7f000001','wss://0177.0.0.1','wss://[::1]','wss://[::ffff:127.0.0.1]','wss://user:pass@public.example','wss://public.example:444','wss://public.example/?secret=x','wss://public.example/#x'])assert.throws(()=>api.recipientRelayUrl(value),undefined,value);
assert.equal(api.recipientRelayUrl('wss://INBOX.example:443/'),b);
const unsafe=list(otherSk,[['r','wss://127.0.0.1'],['r',b,'read','extension'],['r',b,'unknown']]);
reset({[a]:{events:[unsafe,own],note:true,metadata:true},[c]:{}});
result=await api.publishRecipientNote({...args,unsigned:{...unsigned,tags:[['p',other,'wss://private.internal']]}});assert.deepEqual(plain(result.targets),[a]);assert(result.limited);assert(instances.every(s=>[a,c].includes(s.url)));

// Dedup, bounded people/discovery/recipient relays and simultaneous delivery sockets.
const manyPeople=Array.from({length:20},(_,i)=>(i+3).toString(16).padStart(64,'0'));
const manyLists=new Map(manyPeople.map((person,i)=>[person,{tags:Array.from({length:10},(_,j)=>['r',`wss://r${i}-${j}.example/`])}]));
const plan=api.planRecipientDelivery([a,a],manyPeople,manyLists);assert.equal(plan.targets.length,17);assert(plan.limited);
reset(Object.fromEntries(plan.targets.map(url=>[url,{note:true,metadata:true}])));
const note=nostr.finalizeEvent(plain(unsigned),sk);
const receipts=await api.deliverRecipientNote(note,own,plain(plan.targets),signal(),10);assert.equal(receipts.length,17);assert.equal(peak,4);assert.equal(active,0);
reset({});discovery=await api.discoverRecipientRelays([other],Array.from({length:12},(_,i)=>`wss://source${i}.example/`),signal(),2);assert.equal(instances.length,8);assert(discovery.partial);

// No early-success shortcut: note and metadata ACKs are independently accounted for.
reset({[a]:{note:true,metadata:true},[b]:{note:false,metadata:true},[c]:{note:true}});
const partial=await api.deliverRecipientNote(note,own,[a,b,c],signal(),2);assert.equal(partial.filter(r=>r.note).length,2);assert.equal(partial.filter(r=>r.metadata).length,2);
assert(partial.find(r=>r.url===c).note);assert.equal(active,0);

// Abort while connecting, looking up, waiting for signer, and publishing. No late sends.
for(const phase of ['discovery','sign','delivery']){
 const controller=new AbortController();let finishSign;
 reset(phase==='discovery'?{[a]:{connect:false},[c]:{connect:false}}:{[a]:{events:[own,recipient],note:true,metadata:true},[c]:{},[b]:{connect:false}});
 const pending=api.publishRecipientNote({...args,signal:controller.signal,sign:async event=>{if(phase==='sign')await new Promise(resolve=>{finishSign=resolve;});return nostr.finalizeEvent(plain(event),sk);},timeout:1000});
 await new Promise(resolve=>setImmediate(resolve));controller.abort();finishSign?.();await assert.rejects(()=>pending,/中止/);
 for(const ws of instances){const count=ws.frames.length;ws.open();assert.equal(ws.frames.length,count);}assert.equal(active,0);
 if(phase!=='delivery')assert(instances.every(s=>s.frames.every(f=>f[0]!=='EVENT')));
}
for(const mode of ['logout','switch','switch-back','denied','content','tags','pubkey','sig']){
 reset({[a]:{events:[own,recipient]},[c]:{}});let current=owner;const controller=new AbortController();
 await assert.rejects(()=>api.publishRecipientNote({...args,signal:controller.signal,currentOwner:()=>current,sign:async event=>{
   if(mode==='denied')throw Error('denied');
   if(mode==='logout')current='';if(mode==='switch')current=other;if(mode==='switch-back')controller.abort();
   const signed=nostr.finalizeEvent(plain(event),mode==='pubkey'?otherSk:sk);
   if(mode==='content')signed.content='changed';if(mode==='tags')signed.tags=[];if(mode==='sig')signed.sig='0'.repeat(128);
   return signed;
 }}));
 assert(instances.every(s=>s.frames.every(f=>f[0]!=='EVENT')));
}
console.log('PASS recipient routing: disjoint inbox/outbox, verified latest/ties, missing/partial/empty, strict URLs, bounded discovery/fanout, separate ACKs, no settings mutation, cancellation and signer validation');

// Exercise actual App publish integration (real routing, mocked sockets and test signer).
const appSource=await fs.readFile('components/petal-app.tsx','utf8');
const ast=ts.createSourceFile('petal-app.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App');
const callback=app.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='publish');
const notices=[],notes=[],writes=[{url:a,read:true,write:true}];
const harness={AbortSignal,...api,...await load('relays'),...await load('account-relays'),...await load('publication-tags'),verifyEvent:nostr.verifyEvent,
 pubkey:owner,activeUser:{current:owner},relayAccountAbort:{current:new AbortController()},publicationPending:{current:false},accountRelays:{current:{state:{owner,event:own}}},activeRelays:{current:writes},sockets:{current:[]},setBusy(){},notify:m=>notices.push(m),setNotes:fn=>notes.push(fn([])),retainFeed:events=>events,window:{nostr:{signEvent:async event=>nostr.finalizeEvent(plain(event),sk)}},login:async()=>{},publisher:{current:{publish:async()=>{throw Error('must route through recipient delivery');}}}};
vm.createContext(harness);vm.runInContext(ts.transpileModule(callback.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,harness);
reset({[a]:{events:[own,recipient],note:true,metadata:true},[b]:{note:true,metadata:true},'wss://yabu.me/':{events:[recipient]}});
assert(await harness.publish(1,`Hello nostr:${nostr.nip19.npubEncode(other)}`,[]));assert.equal(notes.length,1);assert(notes[0][0].tags.some(t=>t[0]==='p'&&t[1]===other));assert.match(notices.at(-1),/2\/2/);assert.deepEqual(writes,[{url:a,read:true,write:true}]);assert(!harness.publicationPending.current);
// Metadata-only success must retain the draft (return false) and not insert a note.
reset({[a]:{events:[own,recipient],note:false,metadata:true},[b]:{note:false,metadata:true},'wss://yabu.me/':{}});
assert.equal(await harness.publish(1,'reply',[['p',other]]),false);assert.equal(notes.length,1);
// Epoch cancellation after asynchronous signer resolution suppresses stale UI updates.
reset({[a]:{events:[own,recipient]},'wss://yabu.me/':{}});
let release;harness.window.nostr.signEvent=async event=>{await new Promise(resolve=>{release=resolve;});return nostr.finalizeEvent(plain(event),sk);};
const sending=harness.publish(1,'reply',[['p',other]]);await new Promise(resolve=>setImmediate(resolve));
assert.equal(await harness.publish(1,'duplicate',[['p',other]]),false);
const count=notices.length;harness.relayAccountAbort.current.abort();release();assert.equal(await sending,false);assert.equal(notes.length,1);assert.equal(notices.length,count);assert(!harness.publicationPending.current);assert(instances.every(s=>s.frames.every(f=>f[0]!=='EVENT')));
harness.relayAccountAbort.current=new AbortController();
const replyCancel=new AbortController();
reset({[a]:{events:[own,recipient]},'wss://yabu.me/':{}});
const cancelledReply=harness.publish(1,'reply',[['p',other]],replyCancel.signal);
await new Promise(resolve=>setImmediate(resolve));replyCancel.abort();release();assert.equal(await cancelledReply,false);assert(instances.every(s=>s.frames.every(f=>f[0]!=='EVENT')));
console.log('PASS App publication: content mention p-tags, offline own connection, routing, accepted-only note insertion, cancellation, unchanged account settings');

// Actual reply component forwards an abort signal and cancels on unmount.
const replySource=await fs.readFile('components/inline-reply.tsx','utf8'),cleanups=[];
let sentSignal,resolveSend,acceptedDrafts=0;
const react={useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);},useLayoutEffect:fn=>fn()};
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
const replyExports={};
vm.runInNewContext(ts.transpileModule(replySource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:replyExports,require:name=>name==='react'?react:name==='react/jsx-runtime'?jsx:name==='./local-draft'?{useLocalDraft:()=>({text:'reply draft',setText(){},saved:true,accepted(){acceptedDrafts++;}})}:name.includes('button')?{M3eButton:'send',M3eIconButton:'cancel'}:{},AbortController,clearTimeout,setTimeout,window:{matchMedia:()=>({matches:true})}});
const tree=replyExports.default({noteId:note.id,name:'mock',busy:false,onCancel(){},onSend:(text,signal)=>{assert.equal(text,'reply draft');sentSignal=signal;return new Promise(resolve=>{resolveSend=resolve;});}});
function findSend(node){if(!node||typeof node!=='object')return null;if(node.type==='send')return node;for(const child of [node.props?.children].flat()){const found=findSend(child);if(found)return found;}return null;}
findSend(tree).props.onClick();assert(sentSignal&&!sentSignal.aborted);cleanups.forEach(fn=>fn());assert(sentSignal.aborted);resolveSend(false);await new Promise(resolve=>setImmediate(resolve));assert.equal(acceptedDrafts,0);
console.log('PASS InlineReply unmount aborts pending delivery and retains unsent draft');
