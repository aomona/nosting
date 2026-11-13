import fs from 'node:fs/promises';import ts from 'typescript';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import assert from 'node:assert/strict';import {nip19} from 'nostr-tools';
const path=resolve('.sites-runtime/share-test.mjs');await fs.writeFile(path,ts.transpileModule(await fs.readFile('lib/share-note.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
try{const {noteShareUri,shareNote}=await import(pathToFileURL(path));const note={id:'1'.repeat(64),pubkey:'2'.repeat(64)},uri=noteShareUri(note),decoded=nip19.decode(uri.slice(6));assert.equal(decoded.type,'nevent');assert.equal(decoded.data.id,note.id);assert.equal(decoded.data.author,note.pubkey);assert.deepEqual(decoded.data.relays,[]);
let copied='',shared='';assert.equal(await shareNote(note,{share:async d=>{shared=d.text},copy:async t=>{copied=t}}),'shared');assert.equal(shared,uri);assert.equal(copied,'');
assert.equal(await shareNote(note,{copy:async t=>{copied=t}}),'copied');assert.equal(copied,uri);copied='';
assert.equal(await shareNote(note,{share:async()=>{throw {name:'AbortError'}},copy:async t=>{copied=t}}),'cancelled');assert.equal(copied,'');
await assert.rejects(()=>shareNote(note,{share:async()=>{throw {name:'NotAllowedError'}},copy:async t=>{copied=t}}));assert.equal(copied,'');
assert.equal(await shareNote(note,{share:async()=>{throw {name:'NotSupportedError'}},copy:async t=>{copied=t}}),'copied');
assert.throws(()=>noteShareUri({id:'x',pubkey:note.pubkey}));console.log('PASS Share: valid NIP19 URI; no relay disclosure; user share; fallback only unsupported; no copy on cancel/permission refusal')
}finally{await fs.rm(path)}
