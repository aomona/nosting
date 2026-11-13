import fs from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {finalizeEvent,generateSecretKey,getPublicKey,verifyEvent} from 'nostr-tools';

const load=async(path,deps={},globals={})=>{
 const exports={};
 vm.runInNewContext(ts.transpileModule(await fs.readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],URL,JSON,console,setTimeout,clearTimeout,queueMicrotask,...globals});
 return exports;
};
const relays=await load('lib/relays.ts');
const notifications=await load('lib/notifications.ts',{'./relays':relays,'nostr-tools':{verifyEvent}});
const {advanceNotificationCursor,createNotificationHistory}=await load('lib/notification-history.ts',{'./relays':relays,'./notifications':notifications});
const page=(time,count=50)=>Array.from({length:count},()=>({created_at:time}));
let c=advanceNotificationCursor({until:100,limit:50},page(90));assert.equal(c.until,90);
c=advanceNotificationCursor(c,page(90));assert.equal(c.limit,100);assert.equal(c.until,90);
c=advanceNotificationCursor(c,[...page(90,65),...page(89,35)]);assert.equal(c.until,89);assert.equal(c.limit,50);
assert.throws(()=>advanceNotificationCursor({until:90,limit:100},page(90,65)),/ambiguous/);
assert.throws(()=>advanceNotificationCursor({until:90,limit:800},page(90,800)),/limit/);
assert(advanceNotificationCursor({until:90,limit:50},[]).done);
assert(advanceNotificationCursor({until:90,limit:50},page(80,49)).done);
assert.equal(advanceNotificationCursor({until:90,limit:50},page(80,49),50).until,80);
assert(!advanceNotificationCursor({until:90,limit:50},page(80,49),50).done);

// Controller: independent relay coverage, failure retry, head backlog and stable retention.
const a='wss://a.example/',b='wss://b.example/',key='a'.repeat(64);
const visibility={hidden:false,listener:null,addEventListener(_,fn){this.listener=fn},removeEventListener(){this.listener=null},toggle(hidden){this.hidden=hidden;this.listener?.()}};
let clock=1000,state;const runs=[];
const fetch=(_,urls,callback,{cursors})=>{const run={urls,callback,cursors,closed:false};runs.push(run);return()=>{run.closed=true}};
const item=(id,created_at)=>({event:{id,created_at},type:'mention'});
const respond=(run,items,pages)=>run.callback({items,pages,loading:false,complete:pages.filter(p=>p.complete).length,failed:pages.filter(p=>!p.complete).length,total:pages.length,truncated:false});
const result=(url,events,complete=true)=>({url,events,complete});
const session=createNotificationHistory(key,[a,b],s=>state=s,{fetch,visibility,now:()=>clock,intervalMs:100000});
assert(state.loading);assert.equal(runs[0].cursors.get(a).until,1000);
respond(runs[0],[item('a',990),item('b',850)],[result(a,page(900)),result(b,page(800),false)]);
assert.equal(state.failed,1);assert.equal(state.items.length,2);
session.loadOlder(true);assert.equal(runs[1].urls.join(','),b);assert.equal(runs[1].cursors.get(b).until,1000);
respond(runs[1],[item('b',850)],[result(b,page(800))]);assert.equal(state.failed,0);
session.loadOlder();assert.equal(runs[2].cursors.get(a).until,900);assert.equal(runs[2].cursors.get(b).until,800);
respond(runs[2],[item('older',700)],[result(a,[]),result(b,[])]);assert(state.done);
clock=1100;session.refresh();assert.equal(runs[3].cursors.get(a).since,1000);assert.equal(runs[3].cursors.get(a).until,1100);
respond(runs[3],[item('new',1090),item('a',990)],[result(a,page(1050)),result(b,[],false)]);
assert.equal(state.items.map(i=>i.event.id).join(','),'new,a,b,older');assert.equal(state.refreshFailed,1);assert(state.done);
clock=1200;session.refresh();assert.equal(runs[4].cursors.get(a).until,1050);assert.equal(runs[4].cursors.get(a).since,1000);assert.equal(runs[4].cursors.get(b).until,1100);
respond(runs[4],[],[result(a,[]),result(b,[])]);assert.equal(state.refreshFailed,0);
session.refresh();assert.equal(runs[5].cursors.get(a).since,1100);assert.equal(runs[5].cursors.get(a).until,1200);
visibility.toggle(true);assert(runs[5].closed);const old=state;
respond(runs[5],[item('stale',1200)],[result(a,[]),result(b,[])]);assert.equal(state,old);
visibility.toggle(false);assert.equal(runs[6].cursors.get(a).since,1100);assert.equal(runs[6].cursors.get(a).until,1200);
session.stop();assert(runs[6].closed);assert.equal(visibility.listener,null);
const stopped=state;respond(runs[6],[],[result(a,[])]);assert.equal(state,stopped);
const capped=createNotificationHistory(key,[a],s=>state=s,{fetch,visibility,now:()=>clock,limit:2,intervalMs:100000});
respond(runs.at(-1),[item('first',5),item('second',4),item('overflow',3)],[result(a,page(3))]);assert(state.limited);assert.equal(state.items.length,2);
const count=runs.length;capped.loadOlder();capped.refresh();assert.equal(runs.length,count);capped.stop();
const empty=createNotificationHistory(key,[],s=>state=s,{fetch,visibility});assert(!state.loading);assert.equal(state.total,0);empty.stop();

// Actual transport + signatures: cross-relay target barrier and every raw page event retained.
const me=generateSecretKey(),other=generateSecretKey(),pub=getPublicKey(me),time=Math.floor(Date.now()/1000);
const ev=(kind,content,tags=[],sk=other,created_at=time)=>finalizeEvent({kind,content,tags,created_at},sk);
const target=ev(1,'mine',[],me),reaction=ev(7,'+',[['p',pub],['e',target.id]]);
class Socket{readyState=1;sent=[];closed=0;send(s){this.sent.push(JSON.parse(s))}close(){this.closed++;this.readyState=3}emit(a){this.onmessage?.({data:JSON.stringify(a)})}req(){return this.sent.findLast(s=>s[0]==='REQ')}}
let sockets=[];const socket=()=>{const ws=new Socket();sockets.push(ws);return ws};
let snapshot;const stop=notifications.watchNotifications(pub,[a,b],s=>snapshot=s,{socket,cursors:new Map([[a,{until:time,limit:50}],[b,{until:time-10,limit:50}]])});
sockets.forEach(ws=>ws.onopen());const [wa,wb]=sockets,sub=wa.req()[1];
wa.emit(['EVENT',sub,reaction]);wa.emit(['EVENT',sub,reaction]);
wa.emit(['EVENT',sub,ev(1,'self',[['p',pub]],me)]);


wa.emit(['EOSE',sub]);wa.emit(['CLOSED',sub,'already closed']);assert.equal(wa.req()[1],sub);wb.emit(['EOSE',sub]);
const targetSub=wb.req()[1];assert.deepEqual(Array.from(wb.req()[2].ids),[target.id]);
wa.emit(['EOSE',targetSub]);wb.emit(['EVENT',targetSub,target]);wb.emit(['EOSE',targetSub]);
assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].type,'reaction');assert.equal(snapshot.pages[0].events.length,2);assert.equal(snapshot.pages[1].events.length,0);assert.equal(snapshot.complete,2);assert(!snapshot.loading);
stop();assert(sockets.every(ws=>ws.onmessage===null));
// A retry still resolves targets on healthy relays without moving their history cursor.
sockets=[];const targetRetryStop=notifications.watchNotifications(pub,[a],s=>snapshot=s,{socket,targetRelays:[a,b],cursors:new Map([[a,{until:time,limit:50}]])});
sockets[0].onopen();const retrySub=sockets[0].req()[1];sockets[0].emit(['EVENT',retrySub,reaction]);sockets[0].emit(['EOSE',retrySub]);
assert.equal(sockets[1].sent.length,0);sockets[1].onopen();const retryTarget=sockets[1].req();assert.deepEqual(retryTarget[2].kinds,[1]);
sockets[0].emit(['EOSE',retryTarget[1]]);sockets[1].emit(['EVENT',retryTarget[1],target]);sockets[1].emit(['EOSE',retryTarget[1]]);
assert.equal(snapshot.items[0].type,'reaction');assert.equal(snapshot.pages[0].events.length,1);assert.equal(snapshot.pages[1].events.length,0);targetRetryStop();
// Closed/over-limit/timeout pages retain their events but never claim complete coverage.
sockets=[];const overflowStop=notifications.watchNotifications(pub,[a],s=>snapshot=s,{socket,cursors:new Map([[a,{until:time,limit:1}]])});
sockets[0].onopen();const sid=sockets[0].req()[1];
sockets[0].emit(['EVENT',sid,ev(1,'one',[['p',pub]])]);sockets[0].emit(['EVENT',sid,ev(1,'two',[['p',pub]])]);assert.equal(snapshot.failed,1);assert(!snapshot.pages[0].complete);assert(snapshot.truncated);overflowStop();
sockets=[];const invalidStop=notifications.watchNotifications(pub,[a],s=>snapshot=s,{socket,cursors:new Map([[a,{until:time-10,limit:50}]])});
sockets[0].onopen();const invalidId=sockets[0].req()[1];
sockets[0].emit(['EVENT',invalidId,ev(1,'outside until',[['p',pub]])]);
sockets[0].emit(['EVENT',invalidId,{...reaction,sig:'0'.repeat(128)}]);sockets[0].emit(['EOSE',invalidId]);
assert.equal(snapshot.failed,1);assert.equal(snapshot.items.length,0);assert(!snapshot.pages[0].complete);invalidStop();
sockets=[];const timeoutStop=notifications.watchNotifications(pub,[a],s=>snapshot=s,{socket,timeoutMs:5});await new Promise(r=>setTimeout(r,15));assert.equal(snapshot.failed,1);assert(!snapshot.pages[0].complete);timeoutStop();
sockets=[];const memoryStop=notifications.watchNotifications(pub,[a],s=>snapshot=s,{socket,cursors:new Map([[a,{until:time,limit:400}]])});
const largeSocket=sockets[0];largeSocket.onopen();const largeSub=largeSocket.req()[1];
for(let i=0;i<400&&largeSocket.onmessage;i++)largeSocket.emit(['EVENT',largeSub,ev(1,'large'+i+'x'.repeat(8000),[['p',pub],['x','x'.repeat(35000)]])]);
assert.equal(snapshot.failed,1);assert(snapshot.truncated);assert(snapshot.pages[0].events.length<400);assert(!snapshot.pages[0].complete);memoryStop();
console.log('PASS notification inclusive boundaries, capped ambiguity, per-relay retry/coverage, head backlog, retention, hidden/unmount isolation, empty relays, signature/filter/target safety, dedup, overflow and timeout');

// End-to-end controller + real transport against deterministic read-only mock relays.
// A 65-event second spans multiple pages; relay B overlaps A but has its own tail.
const eventAt=(i,t)=>ev(1,'history '+i,[['p',pub]],other,t);
const dense=Array.from({length:65},(_,i)=>eventAt('dense'+i,time-100));
const tail=Array.from({length:80},(_,i)=>eventAt('tail'+i,time-101-i));
const relayEvents=new Map([[a,[...dense,...tail.slice(0,30)]],[b,[...dense.slice(20),...tail.slice(20)]]]);
const expected=new Set([...relayEvents.values()].flat().map(e=>e.id));
const wire=[],connections=[];
class RelaySocket extends Socket{
 constructor(url){super();this.url=url;connections.push(this);queueMicrotask(()=>this.onopen?.())}
 send(data){super.send(data);const [op,id,f]=JSON.parse(data);wire.push([op,id,f]);assert(['REQ','CLOSE'].includes(op));if(op!=='REQ')return;
  queueMicrotask(()=>{
   const rows=relayEvents.get(this.url).filter(e=>(f.until===undefined||e.created_at<=f.until)&&(f.since===undefined||e.created_at>=f.since)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).flatMap((e,i)=>i===0?[e,e]:[e]).slice(0,f.limit);
   for(const e of rows)this.emit(['EVENT',id,e]);this.emit(['EOSE',id]);
  });
 }
}
let integrated;
const integratedSession=createNotificationHistory(pub,[a,b],s=>integrated=s,{visibility,now:()=>time,intervalMs:100000,fetch:(key,urls,callback,options)=>notifications.watchNotifications(key,urls,callback,{...options,socket:url=>new RelaySocket(url)})});
const settle=async()=>{for(let i=0;i<100&&integrated.loading;i++)await new Promise(r=>setImmediate(r));assert(!integrated.loading)};
await settle();let pages=1;
while(!integrated.done&&pages<20){assert.equal(integrated.failed,0);integratedSession.loadOlder();await settle();pages++}
assert(integrated.done);assert.equal(integrated.items.length,expected.size);assert.deepEqual(new Set(integrated.items.map(i=>i.event.id)),expected);
assert(wire.some(([op,,f])=>op==='REQ'&&f.limit===100));assert(connections.every(ws=>ws.readyState===3));
integratedSession.stop();console.log(`PASS full signed multi-relay pagination: ${expected.size} unique notifications, ${pages} pages, 65 same-second events, no gaps or relay writes`);

// Fake timers exercise the production controller's timer ownership and single flight.
let timerId=0;const timers=new Map();
const timed=await load('lib/notification-history.ts',{'./relays':relays,'./notifications':notifications},{setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id)});
visibility.hidden=true;let timedState;const timedRuns=[];
const timerFetch=(_,urls,callback,options)=>{const run={urls,callback,options,closed:0};timedRuns.push(run);return()=>{run.closed++}};
const timedSession=timed.createNotificationHistory(key,[a],s=>timedState=s,{visibility,fetch:timerFetch,now:()=>clock});
assert.equal(timedRuns.length,0);assert.equal(timers.size,0);
visibility.toggle(false);assert.equal(timedRuns.length,1);timedSession.refresh();assert.equal(timedRuns.length,1);
respond(timedRuns[0],[],[result(a,[])]);await Promise.resolve();assert.equal(timedRuns.length,2);assert.equal(timedRuns[0].closed,1);
respond(timedRuns[1],[],[result(a,[])]);assert.equal(timers.size,1);
const tick=[...timers.values()][0];timedSession.loadOlder();assert.equal(timers.size,1);assert.equal(timedRuns.length,3);
timers.clear();tick();assert.equal(timedRuns.length,3);assert(timedState.loading);
respond(timedRuns[2],[],[result(a,[])]);await Promise.resolve();assert.equal(timedRuns.length,4);
visibility.toggle(true);assert.equal(timedRuns[3].closed,1);assert.equal(timers.size,0);assert(!timedState.loading);
visibility.toggle(false);assert.equal(timedRuns.length,5);timedSession.stop();assert.equal(timedRuns[4].closed,1);assert.equal(timers.size,0);
console.log('PASS production notification timer: hidden mount, queued refresh, single flight, completion release, visibility cancellation and disposal');
