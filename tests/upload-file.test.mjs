import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {jpeg} from './fixtures/jpeg.mjs';
const source=await fs.readFile('lib/upload-file.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {prepareUploadFile}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const type of ['', 'image/jpg', 'image/pjpeg', 'application/octet-stream', 'image/jpeg']){
 const f=new File([jpeg],'CAMERA.JPG',{type,lastModified:123});
 const got=await prepareUploadFile(f);
 assert.equal(got.type,'image/jpeg');assert.equal(got.name,f.name);assert.equal(got.lastModified,123);
 assert.deepEqual(new Uint8Array(await got.arrayBuffer()),jpeg);
 if(type==='image/jpeg')assert.equal(got,f);
}
for(const type of ['', 'image/jpeg'])await assert.rejects(()=>prepareUploadFile(new File(['<svg/>'],'fake.jpg',{type})),/PNG・JPEG・WebP/);
for(const size of [0,30_000_001]){
 const f=new File([new Uint8Array(size)],'camera.jpg',{type:'image/jpeg'});
 f.slice=()=>{throw Error('Must reject size before reading')};
 await assert.rejects(()=>prepareUploadFile(f),/30 MB/);
}
const boundary=new Uint8Array(30_000_000);boundary.set(jpeg);
assert.equal((await prepareUploadFile(new File([boundary],'camera.jpg'))).size,30_000_000);
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
assert.equal((await prepareUploadFile(new File([png],'photo.png'))).type,'image/png');
assert.equal((await prepareUploadFile(new File(['RIFF0000WEBP'],'photo.webp'))).type,'image/webp');
console.log('PASS upload file: signature MIME, canonical JPEG aliases, unchanged bytes, spoof rejection, 30 MB boundary before read');

// The JPEG MIME-normalization path must keep accepting GIFs without rewriting frames.
const gif89=new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==','base64'));
const gif87=gif89.slice();gif87[4]=55;
for(const bytes of [gif87,gif89])for(const type of ['', 'application/octet-stream', 'image/gif']){
 const file=new File([bytes],'animation.gif',{type,lastModified:456});
 const prepared=await prepareUploadFile(file);
 assert.equal(prepared.type,'image/gif');assert.equal(prepared.name,file.name);assert.equal(prepared.lastModified,456);
 assert.deepEqual(new Uint8Array(await prepared.arrayBuffer()),bytes);
 if(type==='image/gif')assert.equal(prepared,file);
}
for(const payload of ['GIF88a','GIF89','<svg/>'])await assert.rejects(()=>prepareUploadFile(new File([payload],'fake.gif',{type:'image/gif'})),/PNG・JPEG・WebP・GIF/);
console.log('PASS GIF87a/GIF89a file normalization: canonical MIME, byte preservation, invalid signature rejection');
