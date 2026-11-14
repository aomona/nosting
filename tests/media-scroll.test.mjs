import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const out=resolve('.sites-runtime/media-scroll-test.mjs');
await fs.writeFile(out,ts.transpileModule(await fs.readFile('lib/media-scroll.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
try{
 const {mediaScrollTarget:target}=await import(pathToFileURL(out));
 const cards=[0,328,656,984];
 assert.equal(target(0,cards,700,1),328);
 assert.equal(target(328,cards,700,1),656);
 assert.equal(target(656,cards,700,1),700);
 assert.equal(target(700,cards,700,1),700);
 assert.equal(target(700,cards,700,-1),656);
 assert.equal(target(656,cards,700,-1),328);
 assert.equal(target(328,cards,700,-1),0);
 assert.equal(target(0,cards,700,-1),0);
 // A touch gesture can stop between cards; fractional layout/snap rounding is tolerated.
 assert.equal(target(190,cards,700,1),328);
 assert.equal(target(190,cards,700,-1),0);
 assert.equal(target(327.75,cards,700,1),656);
 assert.equal(target(328.25,cards,700,-1),0);
 assert.equal(target(-10,cards,700,1),328);
 assert.equal(target(710,cards,700,-1),656);
 assert.equal(target(0,[0,270],200,1),200);
 assert.equal(target(0,[0,270],0,1),0);
 assert.equal(target(0,[],0,-1),0);
 console.log('PASS media scroll: adjacent card, clamped end, swipe offsets, fractional widths, overscroll and resize');
}finally{await fs.rm(out);}
