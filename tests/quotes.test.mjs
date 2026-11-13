import fs from 'node:fs/promises';import ts from 'typescript';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {finalizeEvent,generateSecretKey,nip19} from 'nostr-tools';
await fs.mkdir('.sites-runtime',{recursive:true});const dir=await fs.mkdtemp(resolve('.sites-runtime/quotes-test-'));
try{
await fs.writeFile(dir+'/quotes.mjs',ts.transpileModule(await fs.readFile('lib/quotes.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {quoteIds,quoteDisplayContent,QuoteResolver}=await import(pathToFileURL(dir+'/quotes.mjs'));
const key=generateSecretKey();const event=(content='test',tags=[])=>JSON.parse(JSON.stringify(finalizeEvent({kind:1,created_at:1,tags,content},key)));
const ev=event(),note=nip19.noteEncode(ev.id),nevent=nip19.neventEncode({id:ev.id,relays:['wss://unapproved.example/']});
assert.deepEqual(quoteIds('nostr:'+nevent+' '+note,[['q',ev.id,'wss://unapproved.example/']]),[ev.id]);
assert.deepEqual(quoteIds('`nostr:'+note+'`\n\n```\nnostr:'+note+'\n```',[['e',ev.id,'','reply']]),[]);
assert.deepEqual(quoteIds('nostr:'+note,[],ev.id),[]);assert.equal(quoteDisplayContent('hello\n\nnostr:'+note,[ev.id]),'hello');assert.equal(quoteDisplayContent('hello\nnostr:'+note,[ev.id]),'hello');assert.equal(quoteDisplayContent('hello nostr:'+note,[ev.id]),'hello nostr:'+note);assert.equal(quoteDisplayContent('`nostr:'+note+'`',[ev.id]),'`nostr:'+note+'`');assert.deepEqual(quoteIds('nostr:nevent1invalid'),[]);assert.equal(quoteIds('',Array.from({length:5},(_,i)=>['q',String(i).padStart(64,'0')])).length,3);
function socket(url){return{url,readyState:1,sent:[],send(s){this.sent.push(JSON.parse(s))}}}const a=socket('wss://approved.example/'),b=socket('wss://write-only.example/');
const resolver=new QuoteResolver(()=>[a,b],()=>[a.url],10);let p=resolver.request(ev.id);assert.equal(b.sent.length,0);let id=a.sent.at(-1)[1];assert.deepEqual(a.sent.at(-1)[2].ids,[ev.id]);assert.equal(resolver.receive(b.url,['EVENT',id,ev]),false);
resolver.receive(a.url,['EVENT',id,{...ev,content:'tampered'}]);resolver.receive(a.url,['EVENT',id,event('wrong id')]);assert.equal(a.sent.at(-1)[0],'REQ');resolver.receive(a.url,['EVENT',id,ev]);assert.equal((await p).event.id,ev.id);assert.equal(a.sent.at(-1)[0],'CLOSE');const count=a.sent.length;assert.equal((await resolver.request(ev.id)).event.id,ev.id);assert.equal(a.sent.length,count);
const next=event('missing');p=resolver.request(next.id);id=a.sent.at(-1)[1];resolver.receive(a.url,['EOSE',id]);assert.ok((await p).error);
p=resolver.request(next.id);assert.match((await p).error,/タイムアウト/);
p=resolver.request(next.id);resolver.reset();assert.ok((await p).error);assert.equal(resolver.receive(a.url,['EVENT',id,next]),false);
const blocked=new QuoteResolver(()=>[b],()=>[a.url],10);assert.ok((await blocked.request(ev.id)).error);assert.equal(b.sent.length,0);
const queue=new QuoteResolver(()=>[a],()=>[a.url],1000);const before=a.sent.length;const requests=Array.from({length:10},(_,i)=>queue.request(String(i).padStart(64,'0')));assert.equal(a.sent.slice(before).filter(m=>m[0]==='REQ').length,6);queue.reset();assert.ok((await Promise.all(requests)).every(r=>r.error));
console.log('PASS quotes: NIP19/21/q decoding and dedup; code/reply/self exclusion; 3-quote bound; read-only targets; signature+ID checks; cache; CLOSE/EOSE/timeout/reset; 6-job concurrency; no hint connections');
}finally{await fs.rm(dir,{recursive:true,force:true})}
