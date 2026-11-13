import type {HistoryNote} from './history-pager';
export type SearchNote=HistoryNote;
export type SearchSocket=Pick<WebSocket,'url'|'readyState'|'send'>;
export type SearchStatus='loading'|'complete'|'unknown'|'unsupported'|'limited'|'timeout'|'error'|'disconnected'|'cancelled';
export type SearchRelayState={url:string;support:boolean|'unknown';status:SearchStatus;count:number;message:string};
export type SearchResult={query:string;events:SearchNote[];eventRelays:Record<string,string[]>;relays:SearchRelayState[];cancelled:boolean;limited:boolean;generation:number};
export type SearchOptions={support?:Record<string,boolean|undefined>;timeoutMs?:number;onUpdate?:(result:SearchResult)=>void};
type Job={url:string;id:string;socket:SearchSocket;timer:ReturnType<typeof setTimeout>;seen:Set<string>};
type Run={generation:number;query:string;states:Map<string,SearchRelayState>;events:Map<string,SearchNote>;sources:Map<string,Set<string>>;jobs:Map<string,Job>;cancelled:boolean;limited:boolean;launching:boolean;resolve:(result:SearchResult)=>void;onUpdate?:SearchOptions['onUpdate'];updateTimer?:ReturnType<typeof setTimeout>};
let sequence=0;
const PER_RELAY=50,TOTAL=200;
export class RelaySearch {
 private run?:Run;
 private epoch=0;
 get busy(){return !!this.run;}
 private snapshot(run:Run):SearchResult{return {query:run.query,events:[...run.events.values()].sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)),eventRelays:Object.fromEntries([...run.sources].map(([id,urls])=>[id,[...urls]])),relays:[...run.states.values()].map(s=>({...s})),cancelled:run.cancelled,limited:run.limited,generation:run.generation};}
 private emit(run:Run){try{run.onUpdate?.(this.snapshot(run))}catch{/* A UI callback must not strand subscriptions. */}}
 private changed(run:Run){if(!run.updateTimer)run.updateTimer=setTimeout(()=>{run.updateTimer=undefined;if(this.run===run)this.emit(run)},50);}
 private closeJob(run:Run,url:string,status:SearchStatus,message=''){
  const job=run.jobs.get(url);if(!job)return;
  clearTimeout(job.timer);run.jobs.delete(url);
  try{if(job.socket.readyState===1)job.socket.send(JSON.stringify(['CLOSE',job.id]))}catch{}
  const state=run.states.get(url)!;state.status=status;state.message=message;
  this.changed(run);this.settle(run);
 }
 private settle(run:Run){if(run.launching||run.jobs.size)return;clearTimeout(run.updateTimer);run.updateTimer=undefined;if(this.run===run)this.run=undefined;const result=this.snapshot(run);this.emit(run);run.resolve(result);}
 cancel(){const run=this.run;if(!run)return;run.cancelled=true;run.launching=true;for(const url of [...run.jobs.keys()])this.closeJob(run,url,'cancelled','検索を取り消しました');run.launching=false;this.settle(run);}
 disconnect(url:string){const run=this.run;if(run)this.closeJob(run,url,'disconnected','検索中に接続が切れました');}
 /** Uses only supplied read URLs and already-connected sockets. No new socket or publication. */
 start(sockets:SearchSocket[],readUrls:string[],query:string,options:SearchOptions={}):Promise<SearchResult>{
  this.cancel();const generation=++this.epoch;
  let resolve!:(result:SearchResult)=>void;const promise=new Promise<SearchResult>(done=>{resolve=done});
  const run:Run={generation,query:query.trim(),states:new Map(),events:new Map(),sources:new Map(),jobs:new Map(),cancelled:false,limited:false,launching:true,resolve,onUpdate:options.onUpdate};this.run=run;
  const urls=[...new Set(readUrls)];
  for(const url of urls){
   const support=options.support?.[url]??'unknown';
   const state:SearchRelayState={url,support,status:'loading',count:0,message:''};run.states.set(url,state);
   if(!run.query){state.status='cancelled';state.message='検索語を入力してください';continue;}
   if(run.query.length>500){state.status='error';state.message='検索語は500文字以内にしてください';continue;}
   if(support===false){state.status='unsupported';state.message='このリレーはNIP-50検索対応を宣言していません';continue;}
   if(support==='unknown'){state.status='unknown';state.message='このリレーのNIP-50検索対応を確認できません';continue;}
   const socket=sockets.find(s=>s.url===url&&s.readyState===1);
   if(!socket){state.status='disconnected';state.message='読み取りリレーに接続できていません';continue;}
   const id=`search-${generation}-${++sequence}`;
   const timeout=Math.max(1,Math.min(options.timeoutMs??10000,10000));
   const job:Job={url,id,socket,seen:new Set(),timer:setTimeout(()=>this.closeJob(run,url,'timeout','検索がタイムアウトしました。結果は一部の可能性があります'),timeout)};
   run.jobs.set(url,job);
  }
  // Register every job before sending: also safe for synchronous test transports.
  for(const job of [...run.jobs.values()]){if(!run.jobs.has(job.url))continue;try{job.socket.send(JSON.stringify(['REQ',job.id,{kinds:[1],search:run.query,limit:PER_RELAY}]))}catch{this.closeJob(run,job.url,'error','検索リクエストを送信できませんでした')}}
  run.launching=false;this.emit(run);this.settle(run);return promise;
 }
 /** Pass verified ONLY after verifyEvent(event) succeeds. Unverified EVENTs are consumed, never retained. */
 receive(url:string,message:unknown[],verified?:SearchNote):boolean{
  const run=this.run;if(!run)return false;const job=run.jobs.get(url);if(!job||message[1]!==job.id)return false;
  const state=run.states.get(url)!;
  if(message[0]==='EVENT'){
   if(!verified||verified.kind!==1||typeof verified.content!=='string'||verified.content.length>10000||!Number.isSafeInteger(verified.created_at)||verified.created_at<0||!Array.isArray(verified.tags)||!/^[a-f0-9]{64}$/.test(verified.id)||!/^[a-f0-9]{64}$/.test(verified.pubkey))return true;
   const raw=message[2] as {id?:unknown}|undefined;if(raw?.id!==verified.id)return true;
   if(job.seen.has(verified.id))return true;job.seen.add(verified.id);state.count++;
   if(!run.events.has(verified.id)&&run.events.size<TOTAL)run.events.set(verified.id,verified);
   let sources=run.sources.get(verified.id);if(!sources){sources=new Set();run.sources.set(verified.id,sources)}sources.add(url);
   this.changed(run);
   if(run.events.size>=TOTAL){run.limited=true;run.launching=true;for(const target of [...run.jobs.keys()])this.closeJob(run,target,'limited','表示上限200件に達しました。検索語を絞ってください');run.launching=false;this.settle(run);}
   else if(job.seen.size>=PER_RELAY){run.limited=true;this.closeJob(run,url,'limited','このリレーの取得上限50件に達しました');}
  }else if(message[0]==='EOSE')this.closeJob(run,url,state.support===true?'complete':'unknown',state.support===true?'':'応答はありましたが、NIP-50対応は確認できません。検索条件が適用されたか不明です');
  else if(message[0]==='CLOSED'){
   const reason=typeof message[2]==='string'?message[2].slice(0,300):'';
   const unsupported=/unsupported.*(?:search|nip.?50)|(?:search|nip.?50).*not supported/i.test(reason);
   if(unsupported)state.support=false;
   this.closeJob(run,url,unsupported?'unsupported':'error',reason||'リレーが検索を終了しました');
  }
  return true;
 }
}
