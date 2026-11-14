import {jpeg,progressiveJpeg} from './fixtures/jpeg.mjs';
import fs from 'node:fs/promises';import ts from 'typescript';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {finalizeEvent,generateSecretKey} from 'nostr-tools';
await fs.mkdir('.sites-runtime',{recursive:true});const dir=await fs.mkdtemp(resolve('.sites-runtime/upload-test-'));
try{
await fs.writeFile(dir+'/server.mjs',ts.transpileModule(await fs.readFile('lib/upload-server.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {handleUpload,handleMedia,sha256,checkAuth,readImage,RESERVE_SQL,MAX_UPLOAD,imageMime}=await import(pathToFileURL(dir+'/server.mjs'));
const originalMigration=await fs.readFile('drizzle/0000_good_spirit.sql','utf8'),upgrade=await fs.readFile('drizzle/0001_loving_anthem.sql','utf8');const migration=originalMigration+';'+upgrade;
const migrated=new DatabaseSync(':memory:');migrated.exec(originalMigration);migrated.exec("INSERT INTO media_uploads VALUES ('old','pub','hash','media/old.png',5242880,'image/png',1,1,'stored'),('pending','pub','hash','media/pending.png',1,'image/png',1,1,'pending')");migrated.exec(upgrade);assert.equal(migrated.prepare('SELECT state FROM media_uploads WHERE auth_id=?').get('old').state,'stored');assert.equal(migrated.prepare('SELECT state FROM media_uploads WHERE auth_id=?').get('pending').state,'pending');assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM media_uploads').get().n,2);migrated.close();
function db(){
 const sql=new DatabaseSync(':memory:');sql.exec(migration);
 return {sql,prepare(query){return {bind(...args){return {
  async first(){return sql.prepare(query).get(...args)||null},
  async run(){const result=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(result.changes)}}}
 }}}}};
}
function bucket(){const map=new Map();return{map,puts:0,async put(key,bytes){this.puts++;map.set(key,bytes);return {}},async get(key){return map.has(key)?{body:map.get(key),httpEtag:'"test"'}:null}}}
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=','base64')),secret=generateSecretKey(),url='https://petal.example/api/uploads';
const hash=await sha256(png);
assert.equal(imageMime(png),'image/png');const huge=png.slice();new DataView(huge.buffer).setUint32(16,16385);assert.equal(imageMime(huge),null);
assert.equal(imageMime(jpeg),'image/jpeg');assert.equal(imageMime(progressiveJpeg),'image/jpeg');
const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'),0);new DataView(webp.buffer).setUint32(4,22,true);webp.set(new TextEncoder().encode('WEBPVP8X'),8);assert.equal(imageMime(webp),'image/webp');webp[26]=1;assert.equal(imageMime(webp),null);

function auth(patch={}){return finalizeEvent({kind:27235,content:'',created_at:Math.floor(Date.now()/1000),tags:[['u',url],['method','POST'],['payload',hash]],...patch},secret)}
function request(event=auth(),body=png,type='image/png',target=url){return new Request(target,{method:'POST',headers:{'Content-Type':type,Authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64')},body})}
const DB=db(),BUCKET=bucket(),env={DB,BUCKET},event=auth();let response=await handleUpload(request(event),env);assert.equal(response.status,201);const stored=await response.json();assert.match(stored.url,/\/api\/media\/[a-f0-9-]+\.png$/);assert.equal(BUCKET.puts,1);assert.equal((await handleUpload(request(event),env)).status,200);assert.equal(BUCKET.puts,1);
const media=await handleMedia(new Request(stored.url),stored.key,env);assert.equal(media.status,200);assert.equal(media.headers.get('Content-Type'),'image/png');assert.equal(media.headers.get('X-Content-Type-Options'),'nosniff');assert.ok(media.headers.get('Content-Security-Policy').includes('sandbox'));assert.ok(media.headers.get('Cache-Control').includes('immutable'));assert.deepEqual(new Uint8Array(await media.arrayBuffer()),png);
assert.equal((await handleMedia(new Request(url),'../private',env)).status,404);
for(const patch of [{kind:1},{created_at:Math.floor(Date.now()/1000)-61},{created_at:Math.floor(Date.now()/1000)+61},{tags:[['u',url+'?wrong=1'],['method','POST'],['payload',hash]]},{tags:[['u',url],['method','GET'],['payload',hash]]},{tags:[['u',url],['u',url],['method','POST'],['payload',hash]]}])assert.throws(()=>checkAuth(request(auth(patch))));
const bad=JSON.parse(JSON.stringify(auth()));bad.sig='0'.repeat(128);assert.throws(()=>checkAuth(request(bad)));
assert.equal((await handleUpload(request(auth({tags:[['u',url],['method','POST'],['payload','0'.repeat(64)]]})),env)).status,401);
assert.equal((await handleUpload(request(auth(),new TextEncoder().encode('<svg/>'),'image/svg+xml'),env)).status,415);assert.equal((await handleUpload(request(auth(),png,'image/jpeg'),env)).status,415);
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(MAX_UPLOAD+1)})),e=>e.status===413);
// Camera compatibility: segment lengths, not embedded marker bytes, delimit EXIF.
const join=(...parts)=>new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));
const segment=(marker,payload)=>join([255,marker,(payload.length+2)>>8,(payload.length+2)&255],payload);
const exif=segment(0xe1,join(new TextEncoder().encode('Exif\0\0'),[0x49,0x49,42,0,8,0,0,0,0,0,0,0,0,0,255,217,255,192]));
const camera=join(jpeg.slice(0,2),exif,segment(0xe2,new TextEncoder().encode('ICC_PROFILE\0')),jpeg.slice(2),new TextEncoder().encode('camera trailer'));
assert.equal(imageMime(camera),'image/jpeg');
assert.equal(imageMime(join(progressiveJpeg.slice(0,2),exif,progressiveJpeg.slice(2),[0,0,0])),'image/jpeg');
assert.equal(imageMime(join([42],camera).subarray(1)),'image/jpeg'); // non-zero byteOffset
const cameraHash=await sha256(camera),cameraEnv={DB:db(),BUCKET:bucket()};
const cameraResponse=await handleUpload(request(auth({tags:[['u',url],['method','POST'],['payload',cameraHash]]}),camera,'image/jpeg'),cameraEnv);
assert.equal(cameraResponse.status,201);const cameraStored=await cameraResponse.json();
assert.equal(cameraStored.sha256,cameraHash);assert.equal(cameraStored.size,camera.length);
const cameraMedia=await handleMedia(new Request(cameraStored.url),cameraStored.key,cameraEnv);
assert.equal(cameraMedia.headers.get('Content-Type'),'image/jpeg');assert.equal(cameraMedia.headers.get('X-Content-Type-Options'),'nosniff');assert.match(cameraMedia.headers.get('Content-Security-Policy'),/sandbox/);
assert.deepEqual(new Uint8Array(await cameraMedia.arrayBuffer()),camera); // no EXIF/trailer/hash rewrite
const sof=jpeg.findIndex((b,i)=>b===255&&jpeg[i+1]===192),sos=jpeg.findIndex((b,i)=>b===255&&jpeg[i+1]===218);
const withDimensions=(w,h)=>{const b=jpeg.slice(),v=new DataView(b.buffer);v.setUint16(sof+5,h);v.setUint16(sof+7,w);return b};
const jpegRequest=(b,headers={})=>new Request(url,{method:'POST',headers:{'Content-Type':'image/jpeg',...headers},body:b});
for(const [w,h] of [[8000,8000],[16384,1]])assert.equal((await readImage(jpegRequest(withDimensions(w,h)))).mime,'image/jpeg');
for(const [w,h] of [[8001,8000],[16385,1],[1,16385]])await assert.rejects(()=>readImage(jpegRequest(withDimensions(w,h))),e=>e.status===413&&e.message.includes('64 MP'));
const badLength=jpeg.slice();badLength[4]=255;badLength[5]=255;
const badSof=jpeg.slice();badSof[sof+9]=0;
const badSos=jpeg.slice();badSos[sos+4]=4;
const badScanComponent=jpeg.slice();badScanComponent[sos+5]=99;
const entropyStart=sos+2+new DataView(jpeg.buffer).getUint16(sos+2);
for(const broken of [jpeg.slice(0,-2),jpeg.slice(0,-1),join(jpeg.slice(0,sof+19),[255,217]),badLength,badSof,badSos,badScanComponent,withDimensions(0,8),join(jpeg.slice(0,entropyStart),[255,217]),join(jpeg.slice(0,entropyStart),[12,255]),join(jpeg.slice(0,entropyStart),[12,255,0,217]),join(jpeg.slice(0,entropyStart),[12,255,224,0,1,255,217])]){
 assert.equal(imageMime(broken),null);
 await assert.rejects(()=>readImage(jpegRequest(broken)),e=>e.status===415&&e.message.includes('JPEG'));
 const invalidEnv={DB:db(),BUCKET:bucket()};assert.equal((await handleUpload(request(auth(),broken,'image/jpeg'),invalidEnv)).status,415);assert.equal(invalidEnv.BUCKET.puts,0);
}
// Marker-only SOF impostors previously passed without any image scan.
assert.equal(imageMime(new Uint8Array([255,216,255,192,0,8,8,0,1,0,1,0,255,217])),null);
// Exercise entropy escaping/restarts/fill and a later progressive scan truncation.
assert.equal(imageMime(join(jpeg.slice(0,entropyStart),[12,255,0,23,255,208,34,255,255,217])),'image/jpeg');
assert.equal(imageMime(progressiveJpeg.slice(0,-10)),null);
for(const size of [MAX_UPLOAD-1,MAX_UPLOAD]){const padded=new Uint8Array(size);padded.set(camera);assert.equal((await readImage(jpegRequest(padded,{'Content-Length':String(size)}))).size,size)}
await assert.rejects(()=>readImage(jpegRequest(camera,{'Content-Length':String(MAX_UPLOAD+1)})),e=>e.status===413&&e.message.includes('30 MB'));
await assert.rejects(()=>readImage(jpegRequest(new Uint8Array(MAX_UPLOAD+1))),e=>e.status===413&&e.message.includes('30 MB'));
await assert.rejects(()=>readImage(jpegRequest(camera,{'Content-Type':'image/png'})),e=>e.status===415);
const uncertainDB=db();const uncertainEvent=auth({created_at:Math.floor(Date.now()/1000)-1});const uncertain={DB:uncertainDB,BUCKET:{async put(){throw Error('uncertain')}}};assert.equal((await handleUpload(request(uncertainEvent),uncertain)).status,503);assert.equal(uncertainDB.sql.prepare('SELECT state FROM media_uploads').get().state,'pending');assert.equal((await handleUpload(request(uncertainEvent),uncertain)).status,409);
// Every old app quota is removed; only per-image size and replay reservations remain.
function reserve(database,id,pubkey,size,day=1){return database.sql.prepare(RESERVE_SQL).run(id,pubkey,'hash',id,size,'image/png',day,day*86400).changes}
let q=db();for(let i=0;i<400;i++)assert.equal(reserve(q,'large'+i,'same-user',MAX_UPLOAD),1); // 12GiB in one day
q.sql.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10001) INSERT INTO media_uploads SELECT 'tiny'||i,'same-user','hash','tiny'||i,1,'image/png',1,86400,'pending' FROM n");assert.equal(reserve(q,'tiny-over','same-user',1),1);
assert.equal(reserve(q,'same','user',1),1);assert.equal(reserve(q,'same','user',1),0);assert.throws(()=>reserve(q,'too-large','user',MAX_UPLOAD+1));
const concurrent={DB:db(),BUCKET:bucket()},concurrentEvent=auth({created_at:Math.floor(Date.now()/1000)-2});const pair=await Promise.all([handleUpload(request(concurrentEvent),concurrent),handleUpload(request(concurrentEvent),concurrent)]);assert.ok(pair.some(r=>r.status===201));assert.equal(concurrent.BUCKET.puts,1);assert.equal(concurrent.DB.sql.prepare('SELECT COUNT(*) AS n FROM media_uploads').get().n,1);
// Boundary-sized header-valid fixtures; this validator does not decode image pixels.
assert.equal(MAX_UPLOAD,30_000_000);
for(const size of [MAX_UPLOAD-1,MAX_UPLOAD]){const padded=new Uint8Array(size);padded.set(png.slice(0,-12));padded.set(png.slice(-12),size-12);const got=await readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/png','Content-Length':String(size)},body:padded}));assert.equal(got.size,size);assert.equal(got.mime,'image/png')}
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/png','Content-Length':String(MAX_UPLOAD+1)},body:png})),e=>e.status===413);
if(process.env.PETAL_UPLOAD_FIXTURE){const real=new Uint8Array(await fs.readFile(process.env.PETAL_UPLOAD_FIXTURE));assert.ok(real.length>29_000_000&&real.length<=MAX_UPLOAD);const realHash=await sha256(real);const signed=auth({tags:[['u',url],['method','POST'],['payload',realHash]]});const realEnv={DB:db(),BUCKET:bucket()};const response=await handleUpload(new Request(url,{method:'POST',headers:{'Content-Type':'image/png','Content-Length':String(real.length),Authorization:'Nostr '+Buffer.from(JSON.stringify(signed)).toString('base64')},body:real}),realEnv);assert.equal(response.status,201);const row=await response.json();assert.equal(row.size,real.length);assert.equal(row.sha256,realHash);console.log('PASS decoded image fixture upload',real.length)}
// Unknown Content-Length streamed input is capped too.
let sent=0;const stream=new ReadableStream({pull(controller){if(sent++<31)controller.enqueue(new Uint8Array(1024*1024));else controller.close()}});await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/png'},body:stream,duplex:'half'})),e=>e.status===413);
assert.equal((await handleUpload(request(),{})).status,503);
console.log('PASS upload: generated SQLite migration; NIP98 signature/u/method/time/payload; image MIME/magic/size; 30MB boundary, no app daily/count/total quota, data-preserving migration; UNIQUE idempotence/concurrent auth; uncertain storage retained; public media security headers');
}finally{await fs.rm(dir,{recursive:true,force:true})}
