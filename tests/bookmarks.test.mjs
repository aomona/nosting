import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as nostr from 'nostr-tools';
let scripts = {}, sockets = [];
class Socket {
  readyState = 0; frames = [];
  constructor(url) {this.url = url; sockets.push(this); queueMicrotask(() => {if(this.readyState===3)return;this.readyState=1;this.onopen?.();});}
  send(raw) {
    const frame=JSON.parse(raw); this.frames.push(frame);
    assert(['REQ','CLOSE'].includes(frame[0]), 'publications forbidden');
    if(frame[0]==='CLOSE')return;
    queueMicrotask(() => {
      const script=scripts[this.url];
      if(script==='silent')return;
      if(script==='fail'){this.onerror?.();return;}
      for(const event of typeof script==='function'?script(frame.slice(2)):script??[])this.onmessage?.({data:JSON.stringify(['EVENT',frame[1],event])});
      this.onmessage?.({data:JSON.stringify(['EOSE',frame[1]])});
    });
  }
  close(){this.readyState=3;}
}
const modules=new Map();
async function load(name) {
  if(modules.has(name))return modules.get(name);
  const source=await fs.readFile(`lib/${name}.ts`,'utf8'),deps={'nostr-tools':{...nostr,verifyEvent:event=>nostr.verifyEvent(JSON.parse(JSON.stringify(event)))}};
  for(const match of source.matchAll(/from '\.\/([^']+)'/g))deps[`./${match[1]}`]=await load(match[1]);
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],URL,TextEncoder,setTimeout,clearTimeout,AbortController,WebSocket:Socket});
  modules.set(name,exports);return exports;
}
const api=await load('bookmarks'),plain=x=>JSON.parse(JSON.stringify(x));
const sk=nostr.generateSecretKey(),sk2=nostr.generateSecretKey(),owner=nostr.getPublicKey(sk),other=nostr.getPublicKey(sk2),time=Math.floor(Date.now()/1000)-100;
const make=(kind,tags=[],content='',created_at=time,key=sk)=>nostr.finalizeEvent({kind,tags,content,created_at},key);
const note=make(1,[],'old saved note'),note2=make(1,[],'second saved note'),missing='a'.repeat(64);
const list=make(10003,[['e',note.id],['custom','preserved'],['a',`30023:${owner}:article`]],'opaque encrypted part');
const newer=make(10003,[['e',note2.id]],'',time+1);
const memory=new Map([['petal-bookmarks',JSON.stringify([note.id,missing])]]);
const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
const a='wss://a.example/',b='wss://b.example/';
assert.deepEqual(plain(api.readBookmarks(storage,'').local),[note.id,missing]);
assert(memory.has('petal-bookmarks'));assert.equal(api.readBookmarks(storage,owner).local.length,0);
assert.equal(api.readBookmarks(storage,other).local.length,0);
assert.deepEqual(plain(api.readBookmarks(storage,'').local),[note.id,missing]);
const signal=()=>new AbortController().signal;
scripts={[a]:[list],[b]:'fail'};
let result=await api.queryBookmarks([a,b],[{kinds:[10003],authors:[owner]}],signal(),10);
assert(result.partial);assert.equal(result.events[0].id,list.id);assert(sockets.every(s=>s.readyState===3));
for(const invalid of [{...list,content:'tampered'},make(10003,[],'',time,sk2),make(10003,[],'',time+10000)]){
 scripts={[a]:[invalid]};result=await api.queryBookmarks([a],[{kinds:[10003],authors:[owner]}],signal(),10);assert(result.partial);assert.equal(result.events.length,0);
}
scripts={[a]:'silent'};result=await api.queryBookmarks([a],[{kinds:[1],ids:[note.id]}],signal(),2);assert(result.partial);
const abort=new AbortController(),waiting=api.queryBookmarks([a],[{kinds:[1],ids:[note.id]}],abort.signal);abort.abort();await assert.rejects(waiting,/中止/);assert(sockets.every(s=>s.readyState===3));
result=await api.queryBookmarks([],[{kinds:[1],ids:[note.id]}],signal());assert(result.partial);
const select=events=>filters=>events.filter(e=>filters.some(f=>(!f.kinds||f.kinds.includes(e.kind))&&(!f.ids||f.ids.includes(e.id))&&(!f.authors||f.authors.includes(e.pubkey))&&(!f['#e']||e.tags.some(t=>t[0]==='e'&&f['#e'].includes(t[1])))));
scripts={[a]:select([list,note,note2]),[b]:'fail'};
let state;const session=new api.BookmarkSession(storage,s=>state=s);
session.start(owner,[a,b]);await session.refresh();
assert.equal(state.items[0].event.id,note.id);assert(state.partial);assert.deepEqual(plain(state.data.event),plain(list));
assert.equal(api.readBookmarks(storage,owner).event.content,list.content);
assert(session.toggle(missing));assert(session.toggle(note.id));assert(!state.items.some(i=>i.id===note.id));
const reloaded=new api.BookmarkSession(storage,s=>state=s);reloaded.start(owner,[a]);assert(!state.items.some(i=>i.id===note.id));assert(state.items.some(i=>i.id===missing));
await reloaded.refresh();assert.equal(state.items[0].status,'missing');
scripts={[a]:select([newer,note2])};await reloaded.refresh();assert(state.items.some(i=>i.event?.id===note2.id));assert.equal(state.data.event.id,newer.id);
// Older and absent lists cannot regress a previously verified replacement.
scripts={[a]:select([list,note])};await reloaded.refresh();assert.equal(state.data.event.id,newer.id);assert(state.partial);
// Same-second ties follow NIP-01.
const tie=make(10003,[['e',missing]],'',newer.created_at);scripts={[a]:select([tie,newer,note2])};await reloaded.refresh();assert.equal(state.data.event.id,[tie.id,newer.id].sort()[0]);
// Explicit empty list removes remote IDs, while local saves stay private.
const empty=make(10003,[],'',time+2);scripts={[a]:select([empty])};await reloaded.refresh();assert.deepEqual(plain(state.items.map(i=>i.id)),[missing]);assert(!state.partial);
reloaded.start(other,[a]);assert.equal(state.items.length,0);reloaded.start('',[a]);assert.deepEqual(plain(state.items.map(i=>i.id)),[note.id,missing]);
// Authenticated deletion requires the actual note author's key; strangers cannot hide it.
const deletion=make(5,[['e',note.id]]),forged=make(5,[['e',note.id]],'',time,sk2);
scripts={[a]:select([note,forged])};await reloaded.refresh();assert.equal(state.items[0].status,'ready');
scripts={[a]:select([note,deletion])};await reloaded.refresh();assert.equal(state.items[0].status,'deleted');
scripts={[a]:'fail'};await reloaded.refresh();assert.equal(state.items[0].status,'deleted');assert.equal(state.items[1].status,'failed');
// A deletion without a known target author cannot be asserted as authentic.
reloaded.start('',[a]);scripts={[a]:select([deletion])};await reloaded.refresh();assert.equal(state.items[0].status,'missing');
// Account switch and stop reject late promises even from a non-cooperative transport.
const pending=[];let switched;const delayed=new api.BookmarkSession(storage,s=>switched=s,()=>new Promise(resolve=>pending.push(resolve)));
delayed.start(owner,[a]);const old=delayed.refresh();delayed.start(other,[a]);const before=switched;pending.shift()({events:[newer],partial:false});await old;assert.equal(switched,before);assert.equal(switched.owner,other);
const stopped=delayed.refresh();delayed.stop();const last=switched;pending.shift()({events:[newer],partial:false});await stopped;assert.equal(switched,last);
// Storage failures are explicit and do not report a successful save or destroy source data.
const broken=new api.BookmarkSession({getItem:storage.getItem,setItem(){throw Error('quota');}},s=>state=s);
broken.start(owner,[a]);const oldIds=api.bookmarkIds(state.data);assert(!broken.toggle(note2.id));assert.deepEqual(api.bookmarkIds(state.data),oldIds);assert(state.error);
memory.set(api.bookmarkKey(other),'invalid');broken.start(other,[a]);assert(!state.ready);assert(state.error);assert.equal(memory.get(api.bookmarkKey(other)),'invalid');
assert(sockets.every(s=>s.frames.every(f=>f[0]!=='EVENT')));
console.log('PASS bookmarks: migration/reload, account isolation, latest/ties/empty/external update, opaque preservation, explicit ID retrieval, partial failure/retry/timeout, signatures, deletion ownership, cancellation and storage errors');
// More than one bounded page is preserved and can be retrieved without removal.
const many=Array.from({length:501},(_,i)=>(i+1).toString(16).padStart(64,'0'));
const largeStore=new Map([[api.bookmarkKey(''),JSON.stringify({local:many,hidden:[],event:null})]]);
let pages=0,largeState;
const large=new api.BookmarkSession({getItem:k=>largeStore.get(k)??null,setItem:(k,v)=>largeStore.set(k,v)},s=>largeState=s,async(_,filters)=>{pages++;assert(filters[0].ids.length<=50);return {events:[],partial:false};});
large.start('',[a]);await large.refresh();assert.equal(pages,10);assert.equal(largeState.items.filter(i=>i.status==='pending').length,1);assert.match(largeState.error,/続き/);
await large.refresh();assert.equal(largeState.items.filter(i=>i.status==='pending').length,0);assert.equal(largeState.items.length,501);assert.equal(largeState.error,'');
console.log('PASS bounded 500-item pages retain all IDs and prioritize remaining entries on refresh');
// A stale tab's local edit must not revert a newer list or another tab's local save.
const shared=new Map(),sharedStore={getItem:k=>shared.get(k)??null,setItem:(k,v)=>shared.set(k,v)};
let staleState;const staleTab=new api.BookmarkSession(sharedStore,s=>staleState=s,async()=>({events:[list],partial:false}));
staleTab.start(owner,[a]);
shared.set(api.bookmarkKey(owner),JSON.stringify({local:[missing],hidden:[],event:newer}));
assert(staleTab.toggle(note.id));
assert.equal(staleState.data.event.id,newer.id);assert(staleState.data.local.includes(missing));
const freshLocal='b'.repeat(64);
shared.set(api.bookmarkKey(owner),JSON.stringify({...staleState.data,local:[...staleState.data.local,freshLocal]}));
// Force a newer remote replacement so this tests the sync persistence path too.
const latestList=make(10003,[['e',note2.id]],'',time+3);
let resolveRead;const syncing=new api.BookmarkSession(sharedStore,()=>{},()=>new Promise(resolve=>{resolveRead=resolve}));
syncing.start(owner,[a]);const read=syncing.refresh();
shared.set(api.bookmarkKey(owner),JSON.stringify({...api.readBookmarks(sharedStore,owner),local:[missing,freshLocal]}));
resolveRead({events:[latestList],partial:false});
await new Promise(resolve=>setImmediate(resolve));
syncing.stop();resolveRead({events:[],partial:false});await read;
const finalData=api.readBookmarks(sharedStore,owner);
assert.equal(finalData.event.id,latestList.id);assert.deepEqual(plain(finalData.local),[missing,freshLocal]);
console.log('PASS cross-tab saves retain the newest verified list and concurrent local edits');
