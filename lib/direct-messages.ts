import {finalizeEvent,generateSecretKey,getEventHash,nip44,verifyEvent,type Event,type EventTemplate,type UnsignedEvent} from 'nostr-tools';
import {normalizeRelay} from './relays';
export type DmSigner={getPublicKey:()=>Promise<string>;signEvent:(event:EventTemplate)=>Promise<Event>;nip44:{encrypt:(key:string,text:string)=>Promise<string>;decrypt:(key:string,text:string)=>Promise<string>}};
export type Rumor=UnsignedEvent&{id:string};
export const DM_LIMIT=100, DM_TEXT_LIMIT=4000;
export class DmError extends Error {}
function checkCiphertext(content:string){if(typeof content!=='string'||content.length<132||content.length>100000||!/^A[g-v][A-Za-z0-9+/]*={0,2}$/.test(content))throw new DmError('NIP-44 v2の暗号文を確認できませんでした');}
export const isKey=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function assertActive(signal:AbortSignal){if(signal.aborted)throw Error('操作を中止しました');}
// Reparse to avoid trusting nostr-tools' mutable verification cache on caller objects.
export function verified(value:unknown):value is Event{try{return verifyEvent(JSON.parse(JSON.stringify(value)))}catch{return false}}
export async function signDmEvent(signer:DmSigner,owner:string,event:EventTemplate,signal:AbortSignal){
 assertActive(signal);if(await signer.getPublicKey()!==owner)throw new DmError('アカウントが変わりました');assertActive(signal);
 const expected=getEventHash({...event,pubkey:owner});const signed=await signer.signEvent(event);assertActive(signal);
 if(signed.pubkey!==owner||signed.id!==expected||!verified(signed))throw Error('署名を確認できませんでした');return signed;
}
const validTime=(time:number)=>Number.isSafeInteger(time)&&time>=0&&time<=Math.floor(Date.now()/1000)+600;
const randomTime=()=>Math.floor(Date.now()/1000)-crypto.getRandomValues(new Uint32Array(1))[0]%172800;
export function createRumor(owner:string,peer:string,text:string):Rumor{
 if(!isKey(owner)||!isKey(peer)||owner===peer||!text.trim()||text.length>DM_TEXT_LIMIT)throw new DmError('宛先または本文を確認してください');
 const event={pubkey:owner,kind:14,created_at:Math.floor(Date.now()/1000),tags:[['p',peer]],content:text};return {...event,id:getEventHash(event)};
}
export async function wrapDm(rumor:Rumor,recipient:string,signer:DmSigner,signal:AbortSignal):Promise<Event>{
 assertActive(signal);const content=await signer.nip44.encrypt(recipient,JSON.stringify(rumor));assertActive(signal);checkCiphertext(content);
 const seal=await signDmEvent(signer,rumor.pubkey,{kind:13,created_at:randomTime(),tags:[],content},signal);
 const key=generateSecretKey();try{return finalizeEvent({kind:1059,created_at:randomTime(),tags:[['p',recipient]],content:nip44.v2.encrypt(JSON.stringify(seal),nip44.v2.utils.getConversationKey(key,recipient))},key)}finally{key.fill(0)}
}
export async function unwrapDm(value:unknown,owner:string,signer:DmSigner,signal:AbortSignal):Promise<Rumor>{
 assertActive(signal);
 if(!verified(value)||value.kind!==1059||!validTime(value.created_at)||value.content.length>100000||value.tags.filter(t=>t[0]==='p').length!==1||!value.tags.some(t=>t[0]==='p'&&t[1]===owner))throw Error('無効なDM');
 checkCiphertext(value.content);
 const seal:unknown=JSON.parse(await signer.nip44.decrypt(value.pubkey,value.content));assertActive(signal);
 if(!verified(seal)||seal.kind!==13||!validTime(seal.created_at)||seal.tags.length||seal.content.length>60000)throw Error('無効なseal');
 checkCiphertext(seal.content);
 const rumor=JSON.parse(await signer.nip44.decrypt(seal.pubkey,seal.content));assertActive(signal);
 if(!rumor||'sig'in rumor||rumor.kind!==14||rumor.pubkey!==seal.pubkey||!isKey(rumor.pubkey)||!Number.isSafeInteger(rumor.created_at)||rumor.created_at<0||rumor.created_at>Math.floor(Date.now()/1000)+600||typeof rumor.content!=='string'||!rumor.content.trim()||rumor.content.length>DM_TEXT_LIMIT||!Array.isArray(rumor.tags)||!rumor.tags.every((t:unknown)=>Array.isArray(t)&&t.every(v=>typeof v==='string')))throw Error('無効なrumor');
 const recipients=rumor.tags.filter((t:string[])=>t[0]==='p');
 if(recipients.length!==1||!isKey(recipients[0][1])||recipients[0][1]===rumor.pubkey||(rumor.pubkey!==owner&&recipients[0][1]!==owner)||getEventHash(rumor)!==rumor.id)throw Error('宛先または著者が不正です');
 return rumor;
}
export function dmPeer(rumor:Rumor,owner:string){return rumor.pubkey===owner?rumor.tags.find(t=>t[0]==='p')![1]:rumor.pubkey}
export function mergeDms(old:Rumor[],incoming:Rumor[]){return [...new Map([...old,...incoming].map(e=>[e.id,e])).values()].sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id)).slice(-500)}
export function dmRelayList(events:Event[],owner:string){
 const latest=events.filter(e=>e.kind===10050&&e.pubkey===owner&&validTime(e.created_at)&&verified(e)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id))[0];
 // An empty newer list is a revocation, never fall back to an older list.
 const urls=new Set<string>();for(const t of latest?.tags??[])if(t[0]==='relay'&&typeof t[1]==='string'&&t[1].startsWith('wss://'))try{urls.add(normalizeRelay(t[1]))}catch{}
 return [...urls].slice(0,3);
}
