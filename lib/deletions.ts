import {verifyEvent,type Event,type EventTemplate} from 'nostr-tools';

type Socket=Pick<WebSocket,'url'|'readyState'|'send'>;
export type DeletionTarget=Omit<Event,'sig'>&{sig?:string};
// Clone away nostr-tools' verification cache: callers and extensions are untrusted.
function verified(value:DeletionTarget):Event|null{
 try{const event=JSON.parse(JSON.stringify(value)) as Event;return verifyEvent(event)?event:null}catch{return null}
}
export function deletionPayload(target:DeletionTarget,owner:string):EventTemplate{
 const event=verified(target);
 if(!event||![1,6].includes(event.kind)||event.pubkey!==owner)throw Error('自分の投稿・リポストのみ削除できます');
 return {kind:5,created_at:Math.floor(Date.now()/1000),content:'',tags:[['e',event.id],['k',String(event.kind)]]};
}
export async function sendDeletion({target,owner,currentOwner,signal,sign,publish}: {
 target:DeletionTarget;owner:string;currentOwner:()=>string;signal:AbortSignal;
 sign:(event:EventTemplate)=>Promise<Event>;publish:(event:Event)=>Promise<{confirmed:number;total:number}>;
}){
 const check=()=>{if(signal.aborted||currentOwner()!==owner)throw Error('削除要求を中止しました')};
 check();const template=deletionPayload(target,owner),expected=JSON.stringify(template);
 const event=verified(await sign(template));check();
 if(!event||event.pubkey!==owner||JSON.stringify({kind:event.kind,created_at:event.created_at,content:event.content,tags:event.tags})!==expected)throw Error('署名を確認できませんでした');
 const receipt=await publish(event);
 // A request already transmitted cannot be recalled. The caller controls stale UI.
 return {event,...receipt};
}

/** Only verified targets are tracked; a relay's deletion claim is never authoritative. */
export class DeletionTracker{
 private targets=new Map<string,{event:Event;refs:number}>();
 private deleted=new Map<string,string>();
 private listeners=new Set<()=>void>();
 private timer?:ReturnType<typeof setTimeout>;
 private active=new Map<Socket,string>();
 private serial=0;
 constructor(private sockets:()=>Socket[],private readUrls:()=>string[],private retainedLimit=4000){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
 isDeleted=(event:Pick<DeletionTarget,'id'|'pubkey'>)=>this.deleted.get(event.id)===event.pubkey;
 watch(event:DeletionTarget){
  const old=this.targets.get(event.id);
  if(old){if(old.event.pubkey!==event.pubkey)return()=>{};old.refs++}
  else{const valid=verified(event);if(!valid||![1,6].includes(valid.kind))return()=>{};this.targets.set(valid.id,{event:valid,refs:1});this.schedule()}
  return()=>{const target=this.targets.get(event.id);if(target&&!--target.refs){this.targets.delete(event.id);this.trim();this.schedule()}};
 }
 private schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),50)}
 refresh(){
  clearTimeout(this.timer);const allowed=new Set(this.readUrls());
  for(const [ws,id] of this.active)try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',id]))}catch{}
  this.active.clear();if(!this.targets.size)return;
  // One subscription per relay, covering currently mounted rows and references.
  const filter={kinds:[5],'#e':[...this.targets.keys()],authors:[...new Set([...this.targets.values()].map(t=>t.event.pubkey))]};
  for(const ws of this.sockets())if(ws.readyState===1&&allowed.has(ws.url)){
   const id='deletion-'+(++this.serial);this.active.set(ws,id);
   try{ws.send(JSON.stringify(['REQ',id,filter]))}catch{this.active.delete(ws)}
  }
 }
 receive(ws:Socket,frame:unknown[]){
  if(!String(frame[1]).startsWith('deletion-'))return false;
  if(this.active.get(ws)===frame[1]&&frame[0]==='EVENT')this.accept(frame[2] as Event);
  return true;
 }
 accept(value:Event){
  const event=verified(value);if(!event||event.kind!==5)return false;
  let changed=false;
  for(const tag of event.tags){if(tag[0]!=='e')continue;const target=this.targets.get(tag[1])?.event;
   if(!target||target.pubkey!==event.pubkey||this.isDeleted(target))continue;
   this.deleted.set(target.id,target.pubkey);changed=true;
  }
  this.trim();
  if(changed)for(const listener of this.listeners)listener();return changed;
 }
 private trim(){
  // Never resurrect a mounted row to satisfy a cache budget. Only inactive
  // tombstones may be evicted; remounting queries their deletion requests again.
  for(const id of this.deleted.keys()){if(this.deleted.size<=this.retainedLimit)break;if(!this.targets.has(id))this.deleted.delete(id)}
 }
 stop(){clearTimeout(this.timer);for(const [ws,id] of this.active)try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',id]))}catch{}this.active.clear()}
}
