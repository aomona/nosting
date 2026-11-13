import {normalizeRelay} from './relays';
import {verifyEvent,type Event} from 'nostr-tools';
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export type NostrNotification={event:Event;type:'mention'|'reply'|'reaction'|'repost';target?:Event};
export type NotificationSnapshot={items:NostrNotification[];loading:boolean;complete:number;failed:number;total:number;truncated:boolean;pages?:NotificationRelayPage[]};
function valid(e:Event){try{return Boolean(e&&hex(e.id)&&hex(e.pubkey)&&typeof e.content==='string'&&e.content.length<=10000&&Array.isArray(e.tags)&&e.tags.length<=2000&&Number.isSafeInteger(e.created_at)&&e.created_at>=0&&e.created_at<=Date.now()/1000+60&&verifyEvent(e))}catch{return false}}
function parent(e:Event){const es=e.tags.filter(t=>t[0]==='e'&&hex(t[1]));const marked=es.filter(t=>t[3]==='reply');if(marked.length)return marked.length===1?marked[0][1]:undefined;const root=es.filter(t=>t[3]==='root');if(root.length)return root.length===1?root[0][1]:undefined;return es.some(t=>t[3])?undefined:es.at(-1)?.[1]}
export function notificationTarget(e:Event){return e.kind===1?parent(e):e.tags.filter(t=>t[0]==='e'&&hex(t[1])).at(-1)?.[1]}
/** A p tag alone never proves a reaction/repost belongs to the recipient's post. */
export function classifyNotification(e:Event,recipient:string,targets:Map<string,Event>):NostrNotification|null{
 if(!valid(e)||e.pubkey===recipient||![1,6,7].includes(e.kind)||!e.tags.some(t=>t[0]==='p'&&t[1]===recipient))return null;
 const id=notificationTarget(e);let target=id?targets.get(id):undefined;
 if(e.kind===6&&!target&&e.content){try{const embedded=JSON.parse(e.content) as Event;if(embedded.id===id&&embedded.kind===1&&valid(embedded))target=embedded}catch{}}
 if(target&&(!valid(target)||target.id!==id||target.kind!==1||target.pubkey!==recipient))target=undefined;
 if(e.kind===1)return {event:e,type:target?'reply':'mention',target};
 if(!target)return null;
 return {event:e,type:e.kind===7?'reaction':'repost',target};
}
export type NotificationCursor={until?:number;since?:number;limit:number};
export type NotificationRelayPage={url:string;events:Event[];complete:boolean;received?:number};
type WatchOptions={timeoutMs?:number;socket?:(url:string)=>WebSocket;cursors?:ReadonlyMap<string,NotificationCursor>;targetRelays?:string[]};
/** A bounded read, with coverage measured before classification or mute filtering. */
export function watchNotifications(recipient:string,relays:string[],update:(s:NotificationSnapshot)=>void,options:WatchOptions={}){
 const normalize=(list:string[])=>[...new Set(list.flatMap(s=>{try{return [normalizeRelay(s)]}catch{return []}}))].slice(0,16);
 const eventUrls=new Set(normalize(relays)),urls=normalize([...relays,...(options.targetRelays??[])]);
 const targets=new Map<string,Event>();
 const jobs=urls.map(url=>({url,cursor:options.cursors?.get(url)??{limit:200},events:new Map<string,Event>(),ws:undefined as WebSocket|undefined,timer:undefined as ReturnType<typeof setTimeout>|undefined,phase:eventUrls.has(url)?'notifications':'connecting',incomplete:false,failed:false,settled:false,count:0,received:0,ids:[] as string[],requested:new Set<string>()}));
 let alive=true,truncated=false,startedTargets=false,starting=true,retainedCharacters=0;
 const raw=new Map<string,Event>();
 const sub='notifications-'+Math.random().toString(36).slice(2),targetSub=sub+'-targets';
 function close(job:typeof jobs[number]){
  clearTimeout(job.timer);const ws=job.ws;if(!ws)return;job.ws=undefined;
  ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;
  if(ws.readyState===1)for(const id of [sub,targetSub]){try{ws.send(JSON.stringify(['CLOSE',id]))}catch{}}
  try{ws.close()}catch{}
 }
 function snapshot(){
  if(!alive)return;
  const items=[...raw.values()].map(e=>classifyNotification(e,recipient,targets)).filter((e):e is NostrNotification=>Boolean(e)).sort((a,b)=>b.event.created_at-a.event.created_at||a.event.id.localeCompare(b.event.id));
  // Legacy callers still receive their bounded latest view; paged callers retain every page item.
  update({items:options.cursors?items:items.slice(0,200),loading:jobs.some(j=>!j.settled),complete:jobs.filter(j=>j.settled&&!j.failed).length,failed:jobs.filter(j=>j.failed).length,total:urls.length,truncated:truncated||(!options.cursors&&items.length>=200),pages:jobs.map(j=>({url:j.url,events:[...j.events.values()],received:j.received,complete:j.settled&&!j.failed}))});
 }
 function finish(job:typeof jobs[number],ok:boolean){
  if(!alive||job.settled)return;job.failed=!ok||job.incomplete;job.settled=true;close(job);beginTargets();if(!starting)snapshot();
 }
 function nextTargets(job:typeof jobs[number]){
  const ids=job.ids.splice(0,200);job.requested=new Set(ids);
  if(!ids.length){finish(job,true);return}
  try{job.ws!.send(JSON.stringify(['REQ',targetSub,{kinds:[1],ids,limit:ids.length}]))}catch{finish(job,false)}
 }
 function beginTargets(){
  if(starting||startedTargets||jobs.some(j=>!j.settled&&(j.phase==='notifications'||j.phase==='connecting')))return;
  startedTargets=true;
  // Wait for all relay pages before resolving targets, including posts held on another relay.
  const ids=[...new Set(jobs.flatMap(j=>[...j.events.values()].map(notificationTarget).filter((id):id is string=>Boolean(id))))];
  for(const job of jobs)if(!job.settled){job.phase='targets';job.ids=[...ids];nextTargets(job)}
 }
 snapshot();
 for(const job of jobs){
  const {cursor}=job;
  if(!hex(recipient)||!Number.isInteger(cursor.limit)||cursor.limit<1||cursor.limit>800){finish(job,false);continue}
  try{
   const ws=options.socket?options.socket(job.url):new WebSocket(job.url);job.ws=ws;
   job.timer=setTimeout(()=>finish(job,false),options.timeoutMs??12000);
   ws.onopen=()=>{if(!eventUrls.has(job.url)){job.phase='waiting';beginTargets();return}try{ws.send(JSON.stringify(['REQ',sub,{kinds:[1,6,7],'#p':[recipient],limit:cursor.limit,...(cursor.until===undefined?{}:{until:cursor.until}),...(cursor.since===undefined?{}:{since:cursor.since})}]))}catch{finish(job,false)}};
   ws.onerror=ws.onclose=()=>finish(job,false);
   ws.onmessage=m=>{
    if(!alive||job.settled||typeof m.data!=='string')return;
    if(m.data.length>65536){truncated=true;finish(job,false);return}
    try{
     const a=JSON.parse(m.data);if(!Array.isArray(a)||![sub,targetSub].includes(a[1]))return;
     if(a[1]===sub?job.phase!=='notifications':job.phase!=='targets')return;
     if(a[0]==='CLOSED'){finish(job,false);return}
     if(a[0]==='EOSE'){
      if(a[1]===sub&&job.phase==='notifications'){job.phase='waiting';try{ws.send(JSON.stringify(['CLOSE',sub]))}catch{}beginTargets()}
      else if(a[1]===targetSub&&job.phase==='targets')nextTargets(job);
      return;
     }
     if(a[0]!=='EVENT')return;
     if(++job.count>cursor.limit*4+jobs.length*800){truncated=true;finish(job,false);return}
     const e=a[2] as Event;if(!valid(e)){job.incomplete=true;return}
     if(a[1]===targetSub){
      if(job.phase==='targets'&&e.kind===1&&job.requested.has(e.id)&&!targets.has(e.id)){
       retainedCharacters+=m.data.length;if(retainedCharacters>8*1024*1024){truncated=true;finish(job,false);return}targets.set(e.id,e);
      }return;
     }
     if(job.phase!=='notifications')return;
     if(![1,6,7].includes(e.kind)||!e.tags.some(t=>t[0]==='p'&&t[1]===recipient)||(cursor.until!==undefined&&e.created_at>cursor.until)||(cursor.since!==undefined&&e.created_at<cursor.since)){job.incomplete=true;return}
     job.received++;
     if(!job.events.has(e.id)&&job.events.size>=cursor.limit){truncated=true;finish(job,false);return}
     if(!raw.has(e.id)){
      retainedCharacters+=m.data.length;if(retainedCharacters>8*1024*1024){truncated=true;finish(job,false);return}raw.set(e.id,e);
     }
     job.events.set(e.id,raw.get(e.id)!);
    }catch{}
   };
  }catch{finish(job,false)}
 }
 starting=false;beginTargets();snapshot();
 return()=>{alive=false;for(const job of jobs){close(job);job.events.clear();job.ids=[];job.requested.clear()}raw.clear();targets.clear()};
}

/** One bounded fetch at a time. Hidden tabs own neither refresh timers nor sockets. */
export function autoRefreshNotifications(recipient:string,relays:string[],update:(s:NotificationSnapshot)=>void,options:{intervalMs?:number;fetch?:typeof watchNotifications;visibility?:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>}={}){
 const visibility=options.visibility??document;
 let alive=true,epoch=0,stop:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let previous:NotificationSnapshot|undefined;
 function cancel(){epoch++;if(timer!==undefined)clearTimeout(timer);timer=undefined;stop?.();stop=undefined}
 function refresh(){cancel();if(!alive||visibility.hidden)return;const run=epoch;const cleanup=(options.fetch??watchNotifications)(recipient,relays,next=>{
  if(!alive||visibility.hidden||run!==epoch)return;
  const visible={...next,items:next.loading||!next.complete?previous?.items??next.items:next.items};
  if(!next.loading&&next.complete)previous=next;
  update(visible);
  if(!next.loading&&timer===undefined)timer=setTimeout(()=>{timer=undefined;refresh()},options.intervalMs??30000);
 });if(alive&&run===epoch)stop=cleanup;else cleanup()}
 const changed=()=>visibility.hidden?cancel():refresh();
 visibility.addEventListener('visibilitychange',changed);refresh();
 return ()=>{alive=false;cancel();visibility.removeEventListener('visibilitychange',changed)};
}
