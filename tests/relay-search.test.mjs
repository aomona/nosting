import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile('lib/relay-search.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {RelaySearch}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
function socket(url){return {url,readyState:1,messages:[],send(raw){this.messages.push(JSON.parse(raw))}}}
function id(ws){return ws.messages.filter(m=>m[0]==='REQ').at(-1)[1]}
function event(n){return {kind:1,id:n.toString(16).padStart(64,'0'),pubkey:'a'.repeat(64),created_at:1000+n,content:'検索対象 '+n,tags:[]}}
function deliver(search,ws,n){const ev=event(n);return search.receive(ws.url,['EVENT',id(ws),ev],ev)}
const s=new RelaySearch(),a=socket('wss://a.example/'),b=socket('wss://b.example/'),c=socket('wss://c.example/');
let p=s.start([a,b,c],[a.url,b.url,c.url],'word',{support:{[a.url]:true,[b.url]:false}});
assert.equal(a.messages[0][2].search,'word');assert.deepEqual(a.messages[0][2].kinds,[1]);assert.equal(a.messages[0][2].limit,50);assert.equal(b.messages.length,0);assert.equal(c.messages.length,0);
s.receive(a.url,['EVENT',id(a),event(99)]);deliver(s,a,1);deliver(s,a,1);
s.receive(a.url,['EOSE',id(a)]);let r=await p;assert.equal(r.events.length,1);assert.deepEqual(r.relays.map(x=>x.status),['complete','unsupported','unknown']);assert.equal(a.messages.at(-1)[0],'CLOSE');assert.equal(s.busy,false);
p=s.start([a,b],[a.url,b.url],'one',{support:{[a.url]:true,[b.url]:true}});deliver(s,a,1);deliver(s,b,1);deliver(s,b,2);s.receive(a.url,['EOSE',id(a)]);s.receive(b.url,['EOSE',id(b)]);r=await p;assert.equal(r.events.length,2);assert.equal(r.eventRelays[event(1).id].length,2);
p=s.start([a],[a.url],'old',{support:{[a.url]:true}});const old=id(a);const fresh=s.start([a],[a.url],'new',{support:{[a.url]:true}});assert.equal((await p).cancelled,true);assert.equal(s.receive(a.url,['EVENT',old,event(1)],event(1)),false);s.cancel();assert.equal((await fresh).cancelled,true);
p=s.start([a],[a.url],'timeout',{support:{[a.url]:true},timeoutMs:2});r=await p;assert.equal(r.relays[0].status,'timeout');
p=s.start([a],[a.url],'closed',{support:{[a.url]:true}});s.receive(a.url,['CLOSED',id(a),'unsupported: search']);r=await p;assert.equal(r.relays[0].status,'unsupported');
p=s.start([a],[a.url],'disconnect',{support:{[a.url]:true}});s.disconnect(a.url);assert.equal((await p).relays[0].status,'disconnected');
p=s.start([a],[a.url],'validation',{support:{[a.url]:true}});
for(const patch of [{kind:0},{content:'x'.repeat(10001)},{created_at:NaN},{id:'bad'},{pubkey:'bad'}]){const ev={...event(1),...patch};s.receive(a.url,['EVENT',id(a),ev],ev)}s.receive(a.url,['EOSE',id(a)]);assert.equal((await p).events.length,0);
const all=Array.from({length:5},(_,i)=>socket(`wss://${i}.example/`));const support=Object.fromEntries(all.map(ws=>[ws.url,true]));p=s.start(all,all.map(ws=>ws.url),'limit',{support});for(let i=0;i<4;i++)for(let j=0;j<50;j++)deliver(s,all[i],i*50+j);r=await p;assert.equal(r.events.length,200);assert.equal(r.limited,true);assert.ok(all.every(ws=>ws.messages.at(-1)[0]==='CLOSE'));assert.equal(s.busy,false);
const before=a.messages.length;await s.start([a],[a.url],'  ',{support:{[a.url]:true}});await s.start([a],[a.url],'x'.repeat(501),{support:{[a.url]:true}});assert.equal(a.messages.length,before);
const broken=socket('wss://broken.example/');broken.send=()=>{throw Error('closed')};r=await s.start([broken],[broken.url],'word',{support:{[broken.url]:true}});assert.equal(r.relays[0].status,'error');
assert.ok([...a.messages,...b.messages,...all.flatMap(ws=>ws.messages)].every(m=>['REQ','CLOSE'].includes(m[0])));
console.log('PASS relay search: NIP50 support gating, verified events, cross-relay dedup, generation/cancel, timeout/CLOSED/disconnect, limits, query validation, send failures, REQ/CLOSE only');
