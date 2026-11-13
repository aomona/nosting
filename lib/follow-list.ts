import {verifyEvent,type Event,type EventTemplate} from 'nostr-tools';
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function validFollowList(e:Event,owner:string):boolean{try{return e.kind===3&&e.pubkey===owner&&Number.isSafeInteger(e.created_at)&&e.created_at>=0&&typeof e.content==='string'&&e.content.length<=100000&&e.tags.length<=20000&&verifyEvent({id:e.id,pubkey:e.pubkey,created_at:e.created_at,kind:e.kind,content:e.content,tags:e.tags,sig:e.sig})}catch{return false}}
export function followedKeys(event:Event|null):string[]{return [...new Set((event?.tags??[]).filter(t=>t[0]==='p'&&hex(t[1])).map(t=>t[1]))]}
/** Separate last verified display state from completeness of the next refresh. */
export function followDisplay(owner:string,target:string,loaded:Event|null|undefined,known?:Event|null){
 const candidates=[loaded,known].filter((e):e is Event=>Boolean(e&&validFollowList(e,owner))).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id));
 const event=candidates[0]??null;
 return {event,known:Boolean(event)||loaded===null,following:event?followedKeys(event).includes(target):false};
}
export function buildFollowChange(owner:string,base:Event|null,latest:Event|null,target:string,follow:boolean,now=Math.floor(Date.now()/1000)):EventTemplate|null{
 if(!hex(owner)||!hex(target)||owner===target)throw Error('フォロー先を確認してください');
 if(base&&!validFollowList(base,owner)||latest&&!validFollowList(latest,owner))throw Error('フォローリストの署名を確認できません');
 if((base?.id??null)!==(latest?.id??null))throw Error('フォローリストが更新されました。読み直してから操作してください');
 const existing=followedKeys(latest).includes(target);if(existing===follow)return null;
 if(latest&&now<=latest.created_at)throw Error('少し待ってからもう一度操作してください');
 const tags=(latest?.tags??[]).filter(t=>follow||!(t[0]==='p'&&t[1]===target)).map(t=>[...t]);if(follow)tags.push(['p',target,'']);
 if(tags.length>20000)throw Error('フォローリストが大きすぎます');
 return {kind:3,created_at:now,content:latest?.content??'',tags};
}
export async function saveFollowChange(args:{owner:string;base:Event|null;target:string;follow:boolean;signal:AbortSignal;currentOwner:()=>string;load:()=>Promise<Event|null>;sign:(e:EventTemplate)=>Promise<Event>;publish:(e:Event)=>Promise<{confirmed:number;total:number}>}){
 const check=()=>{if(args.signal.aborted)throw Error('操作を中止しました');if(args.currentOwner()!==args.owner)throw Error('ログイン状態が変わりました')};check();const latest=await args.load();check();const unsigned=buildFollowChange(args.owner,args.base,latest,args.target,args.follow);if(!unsigned)return {unchanged:true,event:latest,confirmed:0,total:0};const expected=JSON.stringify(unsigned);const signed=await args.sign(unsigned);check();if(!validFollowList(signed,args.owner)||JSON.stringify({kind:signed.kind,created_at:signed.created_at,content:signed.content,tags:signed.tags})!==expected)throw Error('署名された内容が一致しません');const fresh=await args.load();check();if((latest?.id??null)!==(fresh?.id??null))throw Error('署名中にフォローリストが変わりました。読み直してください');const result=await args.publish(signed);return {...result,event:signed,unchanged:false};
}
export async function loadFollowList(pubkey:string,relays:string[],externalSignal?:AbortSignal,options:{allowPartial?:boolean;onEvent?:(event:Event)=>void}={}):Promise<Event|null>{
 if(!/^[a-f0-9]{64}$/.test(pubkey))throw Error('公開鍵が不正です');
 const urls=[...new Set(relays)];if(!urls.length||urls.length>32)throw Error('読み書き用リレーを確認してください');
 const controller=new AbortController(),signal=controller.signal;const onAbort=()=>controller.abort();externalSignal?.addEventListener('abort',onAbort,{once:true});if(externalSignal?.aborted)controller.abort();
 let latest:Event|null=null;let results:PromiseSettledResult<void>[]=[];
 try{results=await Promise.allSettled(urls.map(url=>new Promise<void>((resolve,reject)=>{
  let ws:WebSocket;let timer:ReturnType<typeof setTimeout>;let settled=false;let count=0;let notice='';const id='follow-list-'+Math.random().toString(36).slice(2);
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',id]));ws.close()}catch{}}error?reject(error):resolve()};
  const abort=()=>finish(Error('読み込みを中止しました'));
  const reason=(message:unknown)=>typeof message==='string'?message.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,240):'';
  const failure=(message:string)=>Error(`${new URL(url).hostname}: ${message}${notice?'（'+notice+'）':''}`);
  try{const u=new URL(url);if(u.protocol!=='wss:'||u.username||u.password||u.hash)throw Error();ws=new WebSocket(url)}catch{finish(Error('リレーURLを確認してください'));return}
  timer=setTimeout(()=>finish(failure('フォローリスト取得がタイムアウトしました')),10000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return}
  ws.onopen=()=>{try{ws.send(JSON.stringify(['REQ',id,{authors:[pubkey],kinds:[3],limit:10}]))}catch{finish(Error('フォローリストを取得できませんでした'))}};
  ws.onerror=ws.onclose=()=>finish(failure('フォローリスト取得中に接続が切れました'));
  ws.onmessage=m=>{if(settled)return;try{if(typeof m.data!=='string'||m.data.length>100000){finish(Error('リレーの応答を安全に確認できません'));return;}const message=JSON.parse(m.data);if(message[0]==='NOTICE'){notice=reason(message[1]);return}if(message[1]!==id)return;if(message[0]==='EOSE'){finish();return}if(message[0]==='CLOSED'){finish(failure('リレーがフォローリスト取得を拒否しました'+(reason(message[2])?': '+reason(message[2]):'')));return}if(message[0]!=='EVENT')return;if(++count>30){finish(Error('リレーの応答が多すぎます'));return}const candidate=message[2] as Event;if(candidate?.kind===3&&candidate.pubkey===pubkey&&Number.isSafeInteger(candidate.created_at)&&candidate.created_at>=0&&verifyEvent(candidate)&&(!latest||candidate.created_at>latest.created_at||candidate.created_at===latest.created_at&&candidate.id<latest.id)){latest=candidate;if(validFollowList(candidate,pubkey))options.onEvent?.(candidate)}}catch{}};
 })));}finally{controller.abort();externalSignal?.removeEventListener('abort',onAbort)}
 if(externalSignal?.aborted)throw Error('読み込みを中止しました');const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(errors.length&&(!options.allowPartial||!latest))throw Error(errors.map(r=>r.reason instanceof Error?r.reason.message:'取得できませんでした').join(' / '));
 if(!latest)return null;if(!validFollowList(latest,pubkey))throw Error('最新のフォローリストを安全に編集できません');return latest;
}
