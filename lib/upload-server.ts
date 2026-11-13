import {verifyEvent,type Event} from 'nostr-tools';
export const MAX_UPLOAD=30_000_000;
export class UploadError extends Error {constructor(public status:number,message:string){super(message)}}
export async function sha256(bytes:Uint8Array){const hash=await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function dimensions(width:number,height:number){return width>0&&height>0&&width<=16384&&height<=16384&&width*height<=64000000}
export function imageMime(bytes:Uint8Array):string|null{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length>=45&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)&&view.getUint32(8)===13&&String.fromCharCode(...bytes.slice(12,16))==='IHDR'&&String.fromCharCode(...bytes.slice(-8,-4))==='IEND'&&dimensions(view.getUint32(16),view.getUint32(20)))return 'image/png';
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
  let p=2;while(p+3<bytes.length){if(bytes[p++]!==255)break;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(p+2>bytes.length)break;const length=view.getUint16(p);if(length<2||p+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8&&dimensions(view.getUint16(p+5),view.getUint16(p+3)))return 'image/jpeg';p+=length;}
 }
 if(bytes.length>=25&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'&&view.getUint32(4,true)===bytes.length-8){
  const type=String.fromCharCode(...bytes.slice(12,16));let width=0,height=0;
  if(type==='VP8X'&&bytes.length>=30){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)}
  if(type==='VP8L'&&bytes[20]===47){const bits=view.getUint32(21,true);width=1+(bits&16383);height=1+((bits>>>14)&16383)}
  if(type==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383}
  if(dimensions(width,height))return 'image/webp';
 }
 return null;
}
const EXTENSIONS:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
export function checkAuth(request:Request,now=Math.floor(Date.now()/1000)):Event{
 if(request.method!=='POST')throw new UploadError(405,'POSTのみ対応しています');
 const header=request.headers.get('Authorization');if(!header?.startsWith('Nostr ')||header.length>16384)throw new UploadError(401,'NIP-98署名が必要です');
 let event:Event;try{const raw=atob(header.slice(6));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new UploadError(401,'署名形式が不正です')}
 try{
  const tag=(key:string)=>{const values=event.tags.filter(t=>t[0]===key);if(values.length!==1||values[0].length!==2)throw Error();return values[0][1]};
  if(event.kind!==27235||event.content!==''||!Number.isSafeInteger(event.created_at)||Math.abs(now-event.created_at)>60||tag('u')!==request.url||tag('method')!=='POST'||!/^[a-f0-9]{64}$/.test(tag('payload'))||!verifyEvent(event))throw Error();
 }catch{throw new UploadError(401,'署名・URL・メソッド・有効期限を確認できませんでした')}
 return event;
}
export async function readImage(request:Request){
 const mime=request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();if(!['image/png','image/jpeg','image/webp'].includes(mime||''))throw new UploadError(415,'PNG・JPEG・WebPのみアップロードできます');
 const encoding=request.headers.get('Content-Encoding');if(encoding&&encoding!=='identity')throw new UploadError(415,'圧縮されたリクエストには対応していません');
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))throw new UploadError(400,'画像サイズが不正です');if(length!==null&&Number(length)>MAX_UPLOAD)throw new UploadError(413,'画像は30 MB以内にしてください');
 if(!request.body)throw new UploadError(400,'画像がありません');
 const reader=request.body.getReader(),parts:Uint8Array[]=[];
 // Known-length uploads use one destination buffer rather than retaining all chunks.
 const destination=length!==null?new Uint8Array(Number(length)):null;let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_UPLOAD){void reader.cancel();throw new UploadError(413,'画像は30 MB以内にしてください')}if(destination){if(size>destination.length){void reader.cancel();throw new UploadError(400,'画像サイズが不正です')}destination.set(value,size-value.length)}else parts.push(value)}}finally{reader.releaseLock()}
 if(!size||length!==null&&Number(length)!==size)throw new UploadError(400,'画像サイズが不正です');
 const bytes=destination??new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}parts.length=0
 if(imageMime(bytes)!==mime)throw new UploadError(415,'画像の形式とContent-Typeが一致しません');return {bytes,mime:mime!,size};
}
export const RESERVE_SQL=`INSERT INTO media_uploads(auth_id,pubkey,payload_hash,object_key,size,mime,day,created_at,state)
 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending')
 ON CONFLICT(auth_id) DO NOTHING`;
type Row={auth_id:string;pubkey:string;payload_hash:string;object_key:string;size:number;mime:string;state:string};
export type UploadBindings={DB?:D1Database;BUCKET?:R2Bucket};
function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
function result(request:Request,row:Row,status=200){return json({url:new URL('/api/media/'+row.object_key.split('/').at(-1),request.url).href,key:row.object_key.split('/').at(-1),mime:row.mime,size:row.size,sha256:row.payload_hash},status)}
export async function handleUpload(request:Request,env:UploadBindings){
 try{
  if(!env.DB||!env.BUCKET)throw new UploadError(503,'画像保存の準備ができていません');
  const event=checkAuth(request),image=await readImage(request),hash=await sha256(image.bytes);
  if(event.tags.find(t=>t[0]==='payload')?.[1]!==hash)throw new UploadError(401,'署名された画像と送信内容が一致しません');
  const find=()=>env.DB!.prepare('SELECT * FROM media_uploads WHERE auth_id=?').bind(event.id).first<Row>();
  const prior=await find();if(prior)return prior.state==='stored'?result(request,prior):json({error:'保存処理の結果を確認中です。同じ画像の重複送信は避けてください'},409);
  const now=Math.floor(Date.now()/1000),key='media/'+crypto.randomUUID()+'.'+EXTENSIONS[image.mime];
  const reserve=await env.DB.prepare(RESERVE_SQL).bind(event.id,event.pubkey,hash,key,image.size,image.mime,Math.floor(now/86400),now).run();
  if(!reserve.success)throw new UploadError(503,'画像保存の予約を確認できませんでした');
  if(!reserve.meta.changes){const existing=await find();if(existing)return existing.state==='stored'?result(request,existing):json({error:'この署名の画像は保存処理中です'},409);throw new UploadError(503,'画像保存の予約を確認できませんでした')}
  // Never release an uncertain reservation: R2 may have committed before a timeout.
  const object=await env.BUCKET.put(key,image.bytes,{httpMetadata:{contentType:image.mime},customMetadata:{sha256:hash}});
  if(!object)throw new UploadError(503,'保存結果を確認できません。画像が保存されている可能性があります');
  const stored=await env.DB.prepare("UPDATE media_uploads SET state='stored' WHERE auth_id=? AND state='pending'").bind(event.id).run();
  if(!stored.success||stored.meta.changes!==1)throw new UploadError(503,'保存結果を確認できません。画像が保存されている可能性があります');
  return result(request,{auth_id:event.id,pubkey:event.pubkey,payload_hash:hash,object_key:key,size:image.size,mime:image.mime,state:'stored'},201);
 }catch(error){return json({error:error instanceof UploadError?error.message:'画像の保存結果を確認できません。画像が保存されている可能性があります'},error instanceof UploadError?error.status:503)}
}
export async function handleMedia(request:Request,key:string,env:UploadBindings){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg|webp)$/.test(key))return new Response(null,{status:404});
 try{if(!env.DB||!env.BUCKET)return new Response(null,{status:503});const row=await env.DB.prepare("SELECT mime,size FROM media_uploads WHERE object_key=? AND state='stored'").bind('media/'+key).first<{mime:string;size:number}>();if(!row||!EXTENSIONS[row.mime]||!key.endsWith('.'+EXTENSIONS[row.mime]))return new Response(null,{status:404});const object=await env.BUCKET.get('media/'+key);if(!object)return new Response(null,{status:404});return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':row.mime,'Content-Length':String(row.size),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'public, max-age=31536000, immutable','Content-Disposition':'inline','ETag':object.httpEtag,'Referrer-Policy':'no-referrer'}})}catch{return new Response(null,{status:503})}
}
