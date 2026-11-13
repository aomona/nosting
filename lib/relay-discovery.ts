import {normalizeRelay,type RelayConfig} from './relays';
import {isLatestReplaceable} from './latest-event';
type RelayListEvent={id:string;pubkey:string;kind:number;created_at:number;tags:string[][]};
export type RelayListResult={relays:RelayConfig[];found:boolean;partial:boolean;cancelled:boolean};
type Socket=Pick<WebSocket,'url'|'readyState'|'send'>;
type Job={socket:Socket;id:string;timer:ReturnType<typeof setTimeout>};
type Run={key:string;jobs:Map<string,Job>;latest:RelayListEvent|null;partial:boolean;cancelled:boolean;launching:boolean;resolve:(result:RelayListResult)=>void;cleanup:()=>void};
let sequence=0;
/** NIP-65 read = owner's inbox; write = owner's outbox. Never grants our write permission. */
export function parseRelayList(event:RelayListEvent):RelayConfig[]{
 const rows=new Map<string,RelayConfig>();if(event.kind!==10002||!Array.isArray(event.tags))return [];
 for(const tag of event.tags.slice(0,4096)){if(!Array.isArray(tag)||tag[0]!=='r'||typeof tag[1]!=='string'||tag.length>3||tag[2]!==undefined&&tag[2]!=='read'&&tag[2]!=='write')continue;let url:string;try{url=normalizeRelay(tag[1])}catch{continue}if(rows.size>=16&&!rows.has(url))continue;const row=rows.get(url)||{url,read:false,write:false};row.read ||= tag[2]!== 'write';row.write ||= tag[2]!== 'read';rows.set(url,row)}return [...rows.values()];
}
/** Author posts are on their write/outbox relays, not their read/inbox relays. */
export function authorPostRelays(relays:RelayConfig[]):RelayConfig[]{return relays.filter(r=>r.write).map(r=>({url:r.url,read:true,write:false}))}
/** Bounded one-shot lookup using only already-authorized read connections. */
export class RelayListDiscovery{
 private run?:Run;
 private close(run:Run,url:string,partial=false){const job=run.jobs.get(url);if(!job)return;clearTimeout(job.timer);run.jobs.delete(url);run.partial ||= partial;try{if(job.socket.readyState===1)job.socket.send(JSON.stringify(['CLOSE',job.id]))}catch{}this.settle(run)}
 private settle(run:Run){if(run.launching||run.jobs.size)return;if(this.run===run)this.run=undefined;run.cleanup();run.resolve({relays:run.latest?parseRelayList(run.latest):[],found:!!run.latest,partial:run.partial,cancelled:run.cancelled})}
 cancel(){const run=this.run;if(!run)return;run.cancelled=true;run.launching=true;for(const url of [...run.jobs.keys()])this.close(run,url);run.launching=false;this.settle(run)}
 disconnect(url:string){if(this.run)this.close(this.run,url,true)}
 start(sockets:Socket[],readUrls:string[],key:string,signal?:AbortSignal,timeoutMs=8000):Promise<RelayListResult>{
  this.cancel();if(!/^[a-f0-9]{64}$/.test(key)||signal?.aborted)return Promise.resolve({relays:[],found:false,partial:true,cancelled:!!signal?.aborted});
  let resolve!:(result:RelayListResult)=>void;const result=new Promise<RelayListResult>(done=>resolve=done);const cancel=()=>this.cancel();
  const run:Run={key,jobs:new Map(),latest:null,partial:false,cancelled:false,launching:true,resolve,cleanup:()=>signal?.removeEventListener('abort',cancel)};this.run=run;signal?.addEventListener('abort',cancel,{once:true});
  for(const raw of [...new Set(readUrls)].slice(0,16)){let url:string;try{url=normalizeRelay(raw)}catch{run.partial=true;continue}const socket=sockets.find(s=>s.url===url&&s.readyState===1);if(!socket){run.partial=true;continue}const id='relay-list-'+(++sequence);run.jobs.set(url,{socket,id,timer:setTimeout(()=>this.close(run,url,true),Math.max(1,Math.min(timeoutMs,8000)))})}
  if(!run.jobs.size)run.partial=true;
  for(const [url,job]of [...run.jobs]){try{job.socket.send(JSON.stringify(['REQ',job.id,{kinds:[10002],authors:[key],limit:1}]))}catch{this.close(run,url,true)}}run.launching=false;this.settle(run);return result;
 }
 /** Caller must verify signature before providing verified. Raw/unrelated events are ignored. */
 receive(url:string,frame:unknown[],verified?:RelayListEvent){const run=this.run,job=run?.jobs.get(url);if(!run||!job||frame[1]!==job.id)return false;
  if(frame[0]==='EVENT'){if(verified&&verified.kind===10002&&verified.pubkey===run.key&&(frame[2] as {id?:string})?.id===verified.id&&/^[a-f0-9]{64}$/.test(verified.id)&&Number.isSafeInteger(verified.created_at)&&verified.created_at>=0&&verified.created_at<=Math.floor(Date.now()/1000)+600&&Array.isArray(verified.tags)&&verified.tags.length<=4096&&isLatestReplaceable(run.latest,verified))run.latest=verified}
  else if(frame[0]==='EOSE'||frame[0]==='CLOSED')this.close(run,url,frame[0]==='CLOSED');return true;
 }
}
