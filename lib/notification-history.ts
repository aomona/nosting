import {normalizeRelay} from './relays';
import {watchNotifications,type NotificationCursor,type NotificationSnapshot,type NostrNotification} from './notifications';

export const NOTIFICATION_LIMIT=1200;
const PAGE_SIZE=50,MAX_PAGE_SIZE=800;
type Cursor=NotificationCursor & {done?:boolean};
export type NotificationHistorySnapshot={items:NostrNotification[];loading:boolean;refreshing:boolean;total:number;failed:number;refreshFailed:number;done:boolean;limited:boolean;boundary:boolean;hasMore:boolean};
export const emptyNotificationHistory:NotificationHistorySnapshot={items:[],loading:true,refreshing:false,total:0,failed:0,refreshFailed:0,done:false,limited:false,boundary:false,hasMore:false};

/** NIP-01 until is inclusive. Never subtract a second from a full page. */
export function advanceNotificationCursor(cursor:Cursor,events:{created_at:number}[],received=events.length):Cursor{
 if(!events.length)return {...cursor,done:true};
 const oldest=Math.min(...events.map(e=>e.created_at));
 if(cursor.limit>PAGE_SIZE&&oldest===cursor.until&&events.length<cursor.limit)throw Error('ambiguous boundary');
 if(events.length<cursor.limit&&received<cursor.limit)return {...cursor,done:true};
 if(cursor.until!==undefined&&oldest>=cursor.until){
  if(cursor.limit>=MAX_PAGE_SIZE)throw Error('boundary limit');
  return {...cursor,limit:cursor.limit*2};
 }
 return {...cursor,until:oldest,limit:PAGE_SIZE};
}

type Options={fetch?:typeof watchNotifications;visibility?:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;intervalMs?:number;now?:()=>number;limit?:number};
/** One owner per mounted account/relay set. Head sweeps and history have separate cursors. */
export function createNotificationHistory(recipient:string,relays:string[],update:(s:NotificationHistorySnapshot)=>void,options:Options={}){
 const urls=[...new Set(relays.flatMap(url=>{try{return [normalizeRelay(url)]}catch{return []}}))].slice(0,16);
 const visibility=options.visibility??document,now=options.now??(()=>Math.floor(Date.now()/1000));
 const initialTime=now(),history=new Map<string,Cursor>(urls.map(url=>[url,{until:initialTime,limit:PAGE_SIZE}]));
 const watermarks=new Map(urls.map(url=>[url,initialTime]));
 const heads=new Map<string,{cursor:Cursor;ceiling:number}>();
 const failed=new Set<string>(),refreshFailed=new Set<string>(),boundaries=new Set<string>();
 const cap=Math.max(1,Math.min(NOTIFICATION_LIMIT,options.limit??NOTIFICATION_LIMIT));
 let items:NostrNotification[]=[],alive=true,busy=false,refreshing=false,epoch=0,limited=false,queuedRefresh=false;
 let stop:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const done=()=>urls.length>0&&urls.every(url=>history.get(url)?.done);
 const emit=()=>{if(alive)update({items,loading:busy,refreshing,total:urls.length,failed:failed.size,refreshFailed:refreshFailed.size,done:done(),limited,boundary:[...boundaries].some(key=>key.startsWith('history')),hasMore:urls.some(url=>!failed.has(url)&&!history.get(url)?.done)})};
 function cancel(){epoch++;stop?.();stop=undefined;clearTimeout(timer);timer=undefined;busy=false;refreshing=false}
 function schedule(){if(alive&&!visibility.hidden&&!limited&&urls.length&&timer===undefined){timer=setTimeout(()=>{timer=undefined;refresh()},options.intervalMs??30000)}}
 function merge(incoming:NostrNotification[]){
  const byId=new Map(items.map(item=>[item.event.id,item]));let changed=false;
  for(const item of incoming){
   const old=byId.get(item.event.id);
   if(old){if(!old.target&&item.target){byId.set(item.event.id,item);changed=true}continue}
   if(byId.size>=cap){limited=true;break}
   byId.set(item.event.id,item);changed=true;
  }
  if(changed)items=[...byId.values()].sort((a,b)=>b.event.created_at-a.event.created_at||a.event.id.localeCompare(b.event.id));
  if(items.length>=cap)limited=true;
 }
 function run(mode:'history'|'refresh',retry=false){
  if(!alive||visibility.hidden||limited||busy||!urls.length)return;
  const selected=urls.filter(url=>mode==='refresh'||(retry?failed.has(url):!failed.has(url)&&!history.get(url)?.done));
  if(!selected.length){emit();return}
  if(mode==='refresh'){clearTimeout(timer);timer=undefined}stop?.();stop=undefined;busy=true;refreshing=mode==='refresh';const runEpoch=++epoch;
  const cursors=new Map<string,Cursor>();
  for(const url of selected){
   if(mode==='history')cursors.set(url,history.get(url)!);
   else{
    if(!heads.has(url)){const ceiling=now();heads.set(url,{cursor:{since:watermarks.get(url)!,until:ceiling,limit:PAGE_SIZE},ceiling})}
    cursors.set(url,heads.get(url)!.cursor);
   }
  }
  emit();
  let finished=false;
  const cleanup=(options.fetch??watchNotifications)(recipient,selected,(snapshot:NotificationSnapshot)=>{
   if(!alive||runEpoch!==epoch||visibility.hidden||snapshot.loading||finished)return;
   finished=true;
   merge(snapshot.items);
   for(const url of selected){
    const page=snapshot.pages?.find(page=>page.url===url),errors=mode==='history'?failed:refreshFailed;
    if(!page?.complete){errors.add(url);continue}
    try{
     const next=advanceNotificationCursor(cursors.get(url)!,page.events,page.received);errors.delete(url);boundaries.delete(mode+url);
     if(mode==='history')history.set(url,next);
     else if(next.done){watermarks.set(url,heads.get(url)!.ceiling);heads.delete(url)}
     else heads.get(url)!.cursor=next;
    }catch{errors.add(url);boundaries.add(mode+url)}
   }
   busy=false;refreshing=false;stop?.();stop=undefined;emit();
   // Each tick advances one bounded head page per relay; incomplete sweeps resume
   // from the same since/until interval, even across failure or tab hiding.
   schedule();
   if(queuedRefresh){queuedRefresh=false;queueMicrotask(refresh)}
  },{cursors,targetRelays:urls});
  if(alive&&runEpoch===epoch&&!finished)stop=cleanup;else cleanup();
 }
 function refresh(){if(!alive||limited)return;if(busy){queuedRefresh=true;return}run('refresh')}
 function loadOlder(retry=false){run('history',retry)}
 const changed=()=>{if(visibility.hidden){cancel();queuedRefresh=false;emit()}else{emit();refresh()}};
 visibility.addEventListener('visibilitychange',changed);
 if(!visibility.hidden&&urls.length)loadOlder();else emit();
 return {loadOlder,refresh,stop(){alive=false;cancel();items=[];history.clear();heads.clear();watermarks.clear();failed.clear();refreshFailed.clear();boundaries.clear();visibility.removeEventListener('visibilitychange',changed)}};
}
