import fs from 'node:fs/promises';import ts from 'typescript';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
await fs.mkdir('.sites-runtime',{recursive:true});const dir=await fs.mkdtemp(resolve('.sites-runtime/navigation-test-'));
try{
 for(const name of ['app-route','local-drafts'])await fs.writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await fs.readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
 const {parseRoute,routeHash,RouteHistory}=await import(pathToFileURL(dir+'/app-route.mjs'));
 const {draftKey,readDraft,writeDraft,clearSentDraft}=await import(pathToFileURL(dir+'/local-drafts.mjs'));
 const a='a'.repeat(64),b='b'.repeat(64);
 for(const route of [{view:'home'},{view:'explore'},{view:'saved'},{view:'notifications'},{view:'profile',id:a},{view:'thread',id:b}])assert.deepEqual(parseRoute(routeHash(route)),route);
 for(const hash of ['#/profile/bad','#/thread/'+a+'/extra','#/settings','#/../home','#main-content'])assert.deepEqual(parseRoute(hash),{view:'home'});
 assert.deepEqual(parseRoute('#home'),{view:'home'});
 const items=new Map(),storage={getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
 const guest=draftKey(''),owner=draftKey(a),reply=draftKey(a,b);
 assert.notEqual(owner,guest);assert.notEqual(reply,owner);assert.notEqual(reply,draftKey(b,b));
 writeDraft(storage,guest,'guest text');writeDraft(storage,owner,'owner text');writeDraft(storage,reply,'reply text');
 assert.equal(readDraft(storage,guest),'guest text');assert.equal(readDraft(storage,owner),'owner text');assert.equal(readDraft(storage,reply),'reply text');
 // A failed publication never calls accepted cleanup; reload remains intact.
 const publish=async()=>false;if(await publish())clearSentDraft(storage,reply,'reply text');assert.equal(readDraft(storage,reply),'reply text');
 writeDraft(storage,reply,'edited while sending');assert.equal(clearSentDraft(storage,reply,'reply text'),false);assert.equal(readDraft(storage,reply),'edited while sending');
 assert.equal(clearSentDraft(storage,reply,'edited while sending'),true);assert.equal(readDraft(storage,reply),'');assert.equal(readDraft(storage,owner),'owner text');
 writeDraft(storage,owner,'');assert.equal(items.has(owner),false);
 const blocked={getItem(){throw Error('denied')},setItem(){throw Error('quota')},removeItem(){throw Error('denied')}};assert.equal(readDraft(blocked,owner),'');assert.equal(writeDraft(blocked,owner,'text'),false);
 writeDraft(storage,owner,'x'.repeat(5000));assert.equal(readDraft(storage,owner).length,4000);
 const frameworkState={__vinext_historyIndex:7,__vinext_bfcacheVersion:3,__vinext_bfcacheIds:{page:'mounted-page'},__vinext_previousNextUrl:'/',previewRouter:{document:'same-document',nested:{preserve:true}},unrelatedToken:'keep-me'};
 const events=new Map(),entries=[{hash:'#/home',state:structuredClone(frameworkState)}];let index=0;let restored=[];
 const host={scrollY:420,innerHeight:800,location:{hash:'#/home'},document:{querySelectorAll:()=>[{dataset:{noteId:a},getBoundingClientRect:()=>({top:-20,bottom:180})}]},addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n)};
 host.history={get state(){return entries[index].state},scrollRestoration:'auto',replaceState(s){entries[index].state=s},pushState(s,_,hash){entries.splice(index+1);entries.push({state:s,hash});index++;host.location.hash=hash},back(){index--;host.location.hash=entries[index].hash;events.get('popstate')?.();events.get('hashchange')?.()}};
 let history;history=new RouteHistory(host,(...args)=>{restored.push(args);history.mark()});const stop=history.start();history.push({view:'thread',id:b});assert.equal(entries[0].state.petalY,420);assert.deepEqual(entries[0].state.petalAnchor,{id:a,offset:-20});assert.equal(host.location.hash,'#/thread/'+b);assert.equal(entries[1].state.petalAnchor,null);assert.equal(entries[1].state.petalY,0);for(const [key,value] of Object.entries(frameworkState)){assert.deepEqual(entries[0].state[key],value,`saved entry preserves ${key}`);assert.deepEqual(entries[1].state[key],value,`new entry preserves ${key}`)};assert.equal(history.back(),true);assert.equal(restored.length,2);assert.deepEqual(restored.at(-1),[{view:'home'},420,{id:a,offset:-20}]);assert.equal(history.back(),false);history.push({view:'thread',id:b},{id:b,offset:135});assert.deepEqual(entries[0].state.petalAnchor,{id:b,offset:135});for(const [key,value] of Object.entries(frameworkState))assert.deepEqual(entries[1].state[key],value,`anchor override preserves ${key}`);assert.equal(history.back(),true);assert.deepEqual(restored.at(-1),[{view:'home'},420,{id:b,offset:135}]);stop();assert.equal(events.size,0);
 console.log('PASS route round trips/deep links, mocked Back restoration/anchor and framework history state preservation, isolated local drafts, failed send retention, successful conditional clear, storage denial');
}finally{await fs.rm(dir,{recursive:true,force:true})}
