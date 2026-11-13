import {verifyEvent,type Event,type EventTemplate} from 'nostr-tools';
export const PROFILE_FIELDS=['name','display_name','about','picture','banner','website'] as const;
export type ProfileField=typeof PROFILE_FIELDS[number];
export type ProfileDraft=Record<ProfileField,string>;
export type EditableProfile={event:Event;metadata:Record<string,unknown>};
const limits:Record<ProfileField,number>={name:100,display_name:100,about:5000,picture:2048,banner:2048,website:2048};
export function parseEditableProfile(event:Event,pubkey:string):EditableProfile|null{try{if(event.kind!==0||event.pubkey!==pubkey||!Number.isSafeInteger(event.created_at)||event.created_at<0||event.content.length>20000||!verifyEvent({id:event.id,pubkey:event.pubkey,kind:event.kind,created_at:event.created_at,content:event.content,tags:event.tags,sig:event.sig}))return null;const data=JSON.parse(event.content);if(!data||typeof data!=='object'||Array.isArray(data))return null;return {event,metadata:data}}catch{return null}}
export function profileDraft(base:EditableProfile|null):ProfileDraft{return Object.fromEntries(PROFILE_FIELDS.map(k=>[k,typeof base?.metadata[k]==='string'?base.metadata[k]:''])) as ProfileDraft}
export function buildProfileEdit(base:EditableProfile|null,latest:EditableProfile|null,draft:ProfileDraft,now=Math.floor(Date.now()/1000)):EventTemplate{
 if((base?.event.id??null)!==(latest?.event.id??null))throw Error('別の場所でプロフィールが更新されました。最新の内容を読み直してください');
 // Do not publish into the future or risk same-second replaceable-event ties.
 if(latest&&now<=latest.event.created_at)throw Error('更新時刻が重なっています。少し待ってから保存してください');
 const data={...(latest?.metadata??{})};const original=profileDraft(latest);
 for(const field of PROFILE_FIELDS){const value=draft[field];if(value===original[field])continue;if(typeof value!=='string'||value.length>limits[field])throw Error(`${field} が長すぎます`);if(['picture','banner','website'].includes(field)&&value){let u:URL;try{u=new URL(value)}catch{throw Error(`${field} のURLを確認してください`)}if(u.protocol!=='https:'||u.username||u.password)throw Error(`${field} はHTTPSのURLを指定してください`)}if(value)data[field]=value;else delete data[field]}
 const content=JSON.stringify(data);if(content.length>20000)throw Error('プロフィール全体が長すぎます');
 return {kind:0,created_at:now,content,tags:(latest?.event.tags??[]).map(t=>[...t])};
}
export async function loadEditableProfile(pubkey:string,relays:string[],externalSignal?:AbortSignal):Promise<EditableProfile|null>{
 if(!/^[a-f0-9]{64}$/.test(pubkey))throw Error('公開鍵が不正です');
 const urls=[...new Set(relays)];if(!urls.length||urls.length>32)throw Error('読み書き用リレーを確認してください');
 const controller=new AbortController(),signal=controller.signal;const onAbort=()=>controller.abort();externalSignal?.addEventListener('abort',onAbort,{once:true});if(externalSignal?.aborted)controller.abort();
 let latest:Event|null=null;
 try{await Promise.all(urls.map(url=>new Promise<void>((resolve,reject)=>{
  let ws:WebSocket;let timer:ReturnType<typeof setTimeout>;let settled=false;let count=0;const id='edit-profile-'+Math.random().toString(36).slice(2);
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',id]));ws.close()}catch{}}error?reject(error):resolve()};
  const abort=()=>finish(Error('読み込みを中止しました'));
  try{const u=new URL(url);if(u.protocol!=='wss:'||u.username||u.password||u.hash)throw Error();ws=new WebSocket(url)}catch{finish(Error('リレーURLを確認してください'));return}
  timer=setTimeout(()=>finish(Error('最新のプロフィールを確認できませんでした。接続を確認してください')),10000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return}
  ws.onopen=()=>{try{ws.send(JSON.stringify(['REQ',id,{authors:[pubkey],kinds:[0],limit:10}]))}catch{finish(Error('プロフィールを取得できませんでした'))}};
  ws.onerror=ws.onclose=()=>finish(Error('一部のリレーから最新のプロフィールを確認できませんでした'));
  ws.onmessage=m=>{if(settled)return;try{if(typeof m.data!=='string'||m.data.length>100000){finish(Error('リレーの応答を安全に確認できません'));return;}const message=JSON.parse(m.data);if(message[1]!==id)return;if(message[0]==='EOSE'){finish();return}if(message[0]==='CLOSED'){finish(Error('リレーがプロフィール取得を拒否しました'));return}if(message[0]!=='EVENT')return;if(++count>30){finish(Error('リレーの応答が多すぎます'));return}const candidate=message[2] as Event;if(candidate?.kind===0&&candidate.pubkey===pubkey&&Number.isSafeInteger(candidate.created_at)&&candidate.created_at>=0&&verifyEvent(candidate)&&(!latest||candidate.created_at>latest.created_at||candidate.created_at===latest.created_at&&candidate.id<latest.id))latest=candidate}catch{}};
 })));}finally{controller.abort();externalSignal?.removeEventListener('abort',onAbort)}
 if(!latest)return null;const parsed=parseEditableProfile(latest,pubkey);if(!parsed)throw Error('最新のプロフィール形式を安全に編集できません');return parsed;
}
export async function saveProfileEdit(args:{owner:string;base:EditableProfile|null;draft:ProfileDraft;signal:AbortSignal;currentOwner:()=>string;load:()=>Promise<EditableProfile|null>;sign:(e:EventTemplate)=>Promise<Event>;publish:(e:Event)=>Promise<{confirmed:number;total:number}>}){
 const check=()=>{if(args.signal.aborted)throw Error('保存を中止しました');if(args.currentOwner()!==args.owner)throw Error('ログイン状態が変わりました')};check();
 const latest=await args.load();check();const unsigned=buildProfileEdit(args.base,latest,args.draft);const expected=JSON.stringify(unsigned);const signed=await args.sign(unsigned);check();
 if(signed.pubkey!==args.owner||JSON.stringify({kind:signed.kind,created_at:signed.created_at,content:signed.content,tags:signed.tags})!==expected||!parseEditableProfile(signed,args.owner))throw Error('署名した内容を確認できません');
 const fresh=await args.load();check();if((fresh?.event.id??null)!==(latest?.event.id??null))throw Error('署名中にプロフィールが更新されました。最新の内容を読み直してください');
 const result=await args.publish(signed);return {...result,profile:parseEditableProfile(signed,args.owner)!};
}
