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
const jpeg=new Uint8Array([255,216,255,192,0,8,8,0,1,0,1,0,255,217]);assert.equal(imageMime(jpeg),'image/jpeg');jpeg[9]=255;assert.equal(imageMime(jpeg),null);
const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'),0);new DataView(webp.buffer).setUint32(4,22,true);webp.set(new TextEncoder().encode('WEBPVP8X'),8);assert.equal(imageMime(webp),'image/webp');webp[26]=1;assert.equal(imageMime(webp),null);

// Small, fully decodable fixtures (clear, four palette indices, EOI), no external files.
function gif({version='89a',frames=1,local=false,interlaced=false}={}){
 const header=[...Buffer.from('GIF'+version),2,0,2,0,local?0:128,0,0];
 const palette=[66,100,39,112,85,140];
 const frame=[0x2c,0,0,0,0,2,0,2,0,(local?128:0)|(interlaced?64:0),...(local?palette:[]),2,4,4,67,48,5,0];
 const loop=[0x21,0xff,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0];
 const control=[0x21,0xf9,4,9,10,0,0,0];
 return new Uint8Array([...header,...(local?[]:palette),...(frames>1?loop:[]),...Array.from({length:frames},()=>[...(version==='89a'?control:[]),...frame]).flat(),0x3b]);
}
const staticGif=gif({version:'87a'}),animatedGif=gif({frames:2}),localGif=gif({local:true,interlaced:true});
// Pillow-generated two-frame, 256-color GIF: variable code widths, dictionary entries,
// transparency, disposal, loop/delay metadata, and a second-frame local color table.
const dictionaryGif=new Uint8Array(Buffer.from('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','base64'));
for(const bytes of [staticGif,animatedGif,localGif,dictionaryGif]){
 assert.equal(imageMime(bytes),'image/gif');
 assert.equal(imageMime(new Uint8Array(Buffer.concat([Buffer.from([1]),bytes,Buffer.from([2])])).subarray(1,bytes.length+1)),'image/gif');
}
// Pack a literal stream through all code-width transitions, dictionary saturation,
// and a clear/reset. The validator must also accept the LZW next-code special case.
function codedGif(codes,width,height){
 let size=3,next=6,previous=false,bits=0,count=0;const data=[];
 for(const code of codes){bits|=code<<count;count+=size;while(count>=8){data.push(bits&255);bits>>>=8;count-=8}if(code===4){size=3;next=6;previous=false}else if(code!==5){if(previous&&next<4096){next++;if(next===(1<<size)&&size<12)size++}previous=true}}
 if(count)data.push(bits&255);const blocks=[];for(let i=0;i<data.length;i+=255)blocks.push(Math.min(255,data.length-i),...data.slice(i,i+255));
 return new Uint8Array([...Buffer.from('GIF87a'),width&255,width>>8,height&255,height>>8,128,0,0,0,0,0,255,255,255,0x2c,0,0,0,0,width&255,width>>8,height&255,height>>8,0,2,...blocks,0,0x3b]);
}
assert.equal(imageMime(codedGif([4,...Array.from({length:5000},(_,i)=>i%2),4,...Array.from({length:5000},(_,i)=>i%2),5],100,100)),'image/gif');
assert.equal(imageMime(codedGif([4,0,6,5],3,1)),'image/gif');
assert.equal(imageMime(codedGif([4,0,7,5],3,1)),null);
assert.equal(imageMime(codedGif([4,0,6,5],2,1)),null);
assert.equal(imageMime(codedGif([4,0,5],2,1)),null);
const corrupt=(source,index,value)=>{const bytes=source.slice();bytes[index]=value;return bytes};
const badGifs=[
 new TextEncoder().encode('<svg onload="alert(1)"/>'),
 corrupt(staticGif,4,56), // Unknown GIF version.
 staticGif.slice(0,-1), // Missing trailer.
 new Uint8Array([...staticGif,0]), // Trailing payload.
 staticGif.slice(0,13), // Missing global color table.
 corrupt(staticGif,6,0),corrupt(staticGif,7,65), // Zero / excessive canvas.
 corrupt(staticGif,24,0),corrupt(staticGif,20,2), // Zero / out-of-canvas frame.
 corrupt(staticGif,28,128), // Truncated local palette.
 corrupt(staticGif,29,1), // Invalid LZW minimum size.
 corrupt(staticGif,30,255), // Truncated data sub-block.
 corrupt(staticGif,31,255), // Invalid initial LZW code.
 corrupt(staticGif,34,0), // Missing EOI.
 corrupt(staticGif,35,1), // Missing block terminator.
 corrupt(staticGif,31,20), // Palette index 2 exceeds two-color table.
 corrupt(animatedGif,40,5), // Invalid graphic-control size.
 corrupt(animatedGif,45,1), // Invalid graphic-control terminator.
 gif({frames:1001}), // Animation frame budget.
];
// Header and image descriptors may individually be valid while cumulative compositing is excessive.
const tooMuchCanvas=gif({frames:2});new DataView(tooMuchCanvas.buffer).setUint16(6,8000,true);new DataView(tooMuchCanvas.buffer).setUint16(8,8000,true);badGifs.push(tooMuchCanvas);
for(const bytes of badGifs){assert.equal(imageMime(bytes),null);await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/gif'},body:bytes})),e=>e.status===415)}
for(let end=0;end<animatedGif.length;end++)assert.equal(imageMime(animatedGif.subarray(0,end)),null,'truncated GIF at '+end);
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/png'},body:animatedGif})),e=>e.status===415);
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/gif'},body:png})),e=>e.status===415);
// Valid GIF comment blocks fill the 30 MB boundary without adding frames or decoded pixels.
function paddedGif(size){const bytes=new Uint8Array(size);bytes.set(staticGif.subarray(0,-1));let p=staticGif.length-1;bytes.set([0x21,0xfe],p);p+=2;while(p<size-2){const remaining=size-2-p;let n=Math.min(255,remaining-1);if(remaining-n-1===1)n--;bytes[p]=n;p+=n+1}bytes.set([0,0x3b],size-2);return bytes}
for(const size of [MAX_UPLOAD-1,MAX_UPLOAD]){const bytes=paddedGif(size);const got=await readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/gif','Content-Length':String(size)},body:bytes}));assert.equal(got.mime,'image/gif');assert.equal(got.size,size)}
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/gif'},body:new Uint8Array(MAX_UPLOAD+1)})),e=>e.status===413);
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/gif','Content-Length':String(MAX_UPLOAD+1)},body:animatedGif})),e=>e.status===413);

function auth(patch={}){return finalizeEvent({kind:27235,content:'',created_at:Math.floor(Date.now()/1000),tags:[['u',url],['method','POST'],['payload',hash]],...patch},secret)}
function request(event=auth(),body=png,type='image/png',target=url){return new Request(target,{method:'POST',headers:{'Content-Type':type,Authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64')},body})}
for(const bytes of [staticGif,animatedGif,dictionaryGif]){
 const gifHash=await sha256(bytes),signed=auth({tags:[['u',url],['method','POST'],['payload',gifHash]]}),gifEnv={DB:db(),BUCKET:bucket()};
 const uploaded=await handleUpload(request(signed,bytes,'image/gif'),gifEnv);assert.equal(uploaded.status,201);
 const stored=await uploaded.json();assert.match(stored.url,/\.gif$/);assert.equal(stored.mime,'image/gif');assert.equal(stored.sha256,gifHash);
 assert.deepEqual(gifEnv.BUCKET.map.get('media/'+stored.key),bytes,'all frames and metadata stored unchanged');
 const served=await handleMedia(new Request(stored.url),stored.key,gifEnv);assert.equal(served.status,200);assert.equal(served.headers.get('Content-Type'),'image/gif');assert.equal(served.headers.get('X-Content-Type-Options'),'nosniff');assert.ok(served.headers.get('Content-Security-Policy').includes('sandbox'));assert.deepEqual(new Uint8Array(await served.arrayBuffer()),bytes);
 const head=await handleMedia(new Request(stored.url,{method:'HEAD'}),stored.key,gifEnv);assert.equal(head.headers.get('Content-Length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal((await handleUpload(request(signed,bytes,'image/gif'),gifEnv)).status,200);assert.equal(gifEnv.BUCKET.puts,1);
 assert.equal((await handleUpload(request(auth(),bytes,'image/gif'),gifEnv)).status,401);
 gifEnv.DB.sql.close();
}
console.log('PASS GIF87a/GIF89a static/animated/interlaced/local palettes; LZW and malformed blocks; frame/pixel/30MB limits; signed upload, byte-preserving storage/GET/HEAD, replay and payload binding');
const DB=db(),BUCKET=bucket(),env={DB,BUCKET},event=auth();let response=await handleUpload(request(event),env);assert.equal(response.status,201);const stored=await response.json();assert.match(stored.url,/\/api\/media\/[a-f0-9-]+\.png$/);assert.equal(BUCKET.puts,1);assert.equal((await handleUpload(request(event),env)).status,200);assert.equal(BUCKET.puts,1);
const media=await handleMedia(new Request(stored.url),stored.key,env);assert.equal(media.status,200);assert.equal(media.headers.get('Content-Type'),'image/png');assert.equal(media.headers.get('X-Content-Type-Options'),'nosniff');assert.ok(media.headers.get('Content-Security-Policy').includes('sandbox'));assert.ok(media.headers.get('Cache-Control').includes('immutable'));assert.deepEqual(new Uint8Array(await media.arrayBuffer()),png);
assert.equal((await handleMedia(new Request(url),'../private',env)).status,404);
for(const patch of [{kind:1},{created_at:Math.floor(Date.now()/1000)-61},{created_at:Math.floor(Date.now()/1000)+61},{tags:[['u',url+'?wrong=1'],['method','POST'],['payload',hash]]},{tags:[['u',url],['method','GET'],['payload',hash]]},{tags:[['u',url],['u',url],['method','POST'],['payload',hash]]}])assert.throws(()=>checkAuth(request(auth(patch))));
const bad=JSON.parse(JSON.stringify(auth()));bad.sig='0'.repeat(128);assert.throws(()=>checkAuth(request(bad)));
assert.equal((await handleUpload(request(auth({tags:[['u',url],['method','POST'],['payload','0'.repeat(64)]]})),env)).status,401);
assert.equal((await handleUpload(request(auth(),new TextEncoder().encode('<svg/>'),'image/svg+xml'),env)).status,415);assert.equal((await handleUpload(request(auth(),png,'image/jpeg'),env)).status,415);
await assert.rejects(()=>readImage(new Request(url,{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(MAX_UPLOAD+1)})),e=>e.status===413);
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
