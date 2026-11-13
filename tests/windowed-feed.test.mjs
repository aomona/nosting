// Pure policy/structure checks; actual observers, layout, focus and state require browser QA.
import fs from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),source=await fs.readFile('components/windowed-feed.tsx','utf8');const output=ts.transpileModule(source.replace("import './windowed-feed.css';",''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const exports={};vm.runInNewContext(output,{exports,require});const{shouldKeepRow,selectionRange}=exports;
assert.equal(shouldKeepRow(false,false,100,false),true);assert.equal(shouldKeepRow(true,false,100,false),false);assert.equal(shouldKeepRow(true,true,100,false),true);assert.equal(shouldKeepRow(true,false,100,true),true);assert.equal(shouldKeepRow(true,false,0,false),true);assert.equal([...selectionRange(['a','b','c','d'],'c','a')].join(','),'a,b,c');assert.equal(selectionRange(['a'],'x','a').size,0);
assert.match(source,/key=\{item.id\}/);assert.match(source,/aria-hidden=\{show\?undefined:true\}/);assert.match(source,/height:record.height/);assert.match(source,/event.key==='Tab'/);assert.doesNotMatch(source,/preventDefault/);assert.match(source,/ResizeObserver/);assert.match(source,/IntersectionObserver/);assert.match(source,/manager\.selection\.has\(id\)/);console.log('PASS row keep/pin/unknown-height policy, selection range, stable slots/keys/placeholders, native Tab fallback; browser layout QA still required');

assert.match(source,/if\(manager.enabled&&!manager.forced&&old!==manager.focus\)/);assert.match(source,/notifyChangedRows\(manager,old,manager.selection\)/);assert.doesNotMatch(source,/const selection=[^\n]*manager.update/);assert.doesNotMatch(source,/const focus=[^\n]*manager.update/);

assert.doesNotMatch(source,/manager.pending/);assert.match(source,/flushSync\(\(\)=>changed.forEach/);assert.match(source,/programmaticScrollY/);

assert.match(source,/restoreAnchor\?:FeedAnchor\|null/);assert.match(source,/manager\.restore\(restoreAnchor\)/);assert.match(source,/focus\(\{preventScroll:true\}\)/);assert.match(source,/cancelAnimationFrame\(frame\)/);

assert.equal(exports.initialRowGeometry(true).near,false);assert.equal(exports.initialRowGeometry(true).height,220);assert.equal(exports.initialRowGeometry(false).near,true);assert.equal(exports.initialRowGeometry(false).height,0);assert.match(source,/if\(enabled&&restoreAnchor\)m.focus=restoreAnchor.id/);
const content=await fs.readFile('components/note-content.tsx','utf8'),app=await fs.readFile('components/petal-app.tsx','utf8');
assert.match(content,/useRowRetention\(videoReady\|\|failed\)/);
assert.match(content,/useRowRetention\(revealed\|\|expanded!==null\|\|open\)/);
assert.match(app,/\[lightweight,setLightweight\]=useState\(false\)/);
assert.match(app,/lightweight=\{lightweight&&\(view==='home'\|\|view==='profile'\)\}/);
assert.match(app,/behavior:same&&next==='home'&&!lightweight/);
assert.match(app,/setFeedRestore\(anchor\)/);
assert.match(app,/restoreAnchor=\{feedRestore\}/);
