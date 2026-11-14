import {DmError,assertActive,createRumor,dmRelayList,wrapDm,type DmSigner,type Rumor} from './direct-messages';
import {dmPublish,dmQuery} from './dm-relay';
import type {Event} from 'nostr-tools';
export type DmContext={owner:string;signer:DmSigner;signal:AbortSignal;allowAuth:boolean;lookup:string[]};
export type PendingDm={rumor:Rumor;peer:string;recipient:Event;archive:Event};
export async function resolveDmRelays(owner:string,context:DmContext){
 const results=await dmQuery(context.lookup,{kinds:[10050],authors:[owner],limit:20},context);
 if(!results.length||results.some(r=>!r.ok))throw new DmError('受信先を確認できません。リレー接続を確認してください');
 const urls=dmRelayList(results.flatMap(r=>r.events),owner);
 if(!urls.length)throw new DmError(owner===context.owner?'DM受信リレーを設定してください':'相手のDM受信リレーが未設定です');return urls;
}
export async function prepareDm(peer:string,text:string,context:DmContext):Promise<PendingDm>{
 // Resolve both before asking the signer to encrypt anything. Never guess inboxes.
 await resolveDmRelays(peer,context);await resolveDmRelays(context.owner,context);
 const rumor=createRumor(context.owner,peer,text);
 const recipient=await wrapDm(rumor,peer,context.signer,context.signal);
 const archive=await wrapDm(rumor,context.owner,context.signer,context.signal);assertActive(context.signal);
 return {rumor,peer,recipient,archive};
}
export async function deliverDm(pending:PendingDm,context:DmContext){
 const recipientRelays=await resolveDmRelays(pending.peer,context),ownRelays=await resolveDmRelays(context.owner,context);
 if(pending.rumor.pubkey!==context.owner||await context.signer.getPublicKey()!==context.owner)throw new DmError('アカウントが変わりました');assertActive(context.signal);
 const recipient=await dmPublish(recipientRelays,pending.recipient,context);
 // Keep an encrypted sender copy even when recipient acknowledgement is uncertain.
 const archive=await dmPublish(ownRelays,pending.archive,context);
 return {recipient,archive};
}
