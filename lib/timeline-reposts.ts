import {verifyEvent,type Event} from 'nostr-tools';
import {validInboundEvent} from './relay-connections';
import {repostRelayUrl} from './repost';

type Reference={id:string;author?:string;event?:Event};
/** Verify a fresh wire-shaped copy: nostr-tools caches verification on objects. */
function verified(value:unknown):Event|null{
 try{const event=JSON.parse(JSON.stringify(value));return validInboundEvent(event)&&verifyEvent(event)?event:null}catch{return null}
}
export function repostOriginal(reference:Reference,value:unknown):Event|null{
 const event=verified(value);
 return event?.kind===1&&event.id===reference.id&&(!reference.author||event.pubkey===reference.author)?event:null;
}
/** Ambiguous references and invalid embedded events are never rendered as notes. */
export function readTimelineRepost(value:unknown):Reference|null{
 const event=verified(value);if(!event||event.kind!==6)return null;
 const es=event.tags.filter(t=>t[0]==='e'),ps=event.tags.filter(t=>t[0]==='p');
 if(es.length!==1||! /^[a-f0-9]{64}$/.test(es[0][1]||'')||!repostRelayUrl(es[0][2]||''))return null;
 if(ps.some(t=>! /^[a-f0-9]{64}$/.test(t[1]||'')||t[1]!==ps[0][1])||event.tags.some(t=>t[0]==='k'&&t[1]!=='1'))return null;
 const reference:Reference={id:es[0][1],author:ps[0]?.[1]};
 if(event.content){try{const original=repostOriginal(reference,JSON.parse(event.content));return original?{...reference,event:original}:null}catch{return null}}
 return reference;
}

type Job={event:Event;reference:Reference;state:'queued'|'active'|'failed'|'done'};
/** Retained feed IDs own the results; bounded work uses the existing read-relay resolver.
 * Relay hints are validated but never create unsolicited connections. Failed lookups
 * retry on reconnect, while reset prevents late results from a previous relay config. */
export class TimelineReposts{
 private jobs=new Map<string,Job>();private seen=new Set<string>();private active=0;private epoch=0;private availability=0;
 constructor(private lookup:(id:string)=>Promise<{event?:Event}>,private resolved:(repost:Event,original:Event)=>void,private limit=1200){}
 add(event:Event){
  if(this.seen.has(event.id)||this.seen.size>=this.limit)return;this.seen.add(event.id);
  const reference=readTimelineRepost(event);if(!reference)return;
  const job:Job={event,reference,state:reference.event?'done':'queued'};this.jobs.set(event.id,job);
  if(reference.event)this.resolved(event,reference.event);else this.pump();
 }
 retry(){this.availability++;for(const j of this.jobs.values())if(j.state==='failed')j.state='queued';this.pump()}
 reset(){this.epoch++;this.jobs.clear();this.seen.clear();this.active=0}
 private pump(){
  for(const job of this.jobs.values()){
   if(this.active>=4)break;if(job.state!=='queued')continue;
   const epoch=this.epoch,availability=this.availability;job.state='active';this.active++;
   void Promise.resolve().then(()=>this.lookup(job.reference.id)).then(result=>{
    if(epoch!==this.epoch)return;const original=repostOriginal(job.reference,result.event);
    job.state=original?'done':availability!==this.availability?'queued':'failed';if(original)this.resolved(job.event,original);
   }).catch(()=>{if(epoch===this.epoch)job.state=availability!==this.availability?'queued':'failed'}).finally(()=>{if(epoch===this.epoch){this.active--;this.pump()}});
  }
 }
}
