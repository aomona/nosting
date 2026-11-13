import {normalizeRelay} from './relays';
import {verifyEvent,type Event} from 'nostr-tools';
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export type NostrNotification={event:Event;type:'mention'|'reply'|'reaction'|'repost';target?:Event};
export type NotificationSnapshot={items:NostrNotification[];loading:boolean;complete:number;failed:number;total:number;truncated:boolean};
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
export function watchNotifications(recipient:string,relays:string[],update:(s:NotificationSnapshot)=>void,options:{timeoutMs?:number;socket?:(url:string)=>WebSocket}={}){
 let alive=true,truncated=false;const raw=new Map<string,Event>(),targets=new Map<string,Event>(),done=new Set<string>(),failed=new Set<string>();
 const urls=[...new Set(relays.flatMap(s=>{try{return [normalizeRelay(s)]}catch{return []}}))].slice(0,16);
 const sockets=new Map<string,WebSocket>(),timers=new Map<string,ReturnType<typeof setTimeout>>();const sub='notifications-'+Math.random().toString(36).slice(2),targetSub=sub+'-targets';
 function closeSocket(ws:WebSocket){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;if(ws.readyState===1){for(const id of [sub,targetSub]){try{ws.send(JSON.stringify(['CLOSE',id]))}catch{}}}try{ws.close()}catch{}}
 const snapshot=()=>{if(!alive)return;const items=[...raw.values()].map(e=>classifyNotification(e,recipient,targets)).filter((e):e is NostrNotification=>Boolean(e)).sort((a,b)=>b.event.created_at-a.event.created_at||a.event.id.localeCompare(b.event.id)).slice(0,200);update({items,loading:done.size+failed.size<urls.length,complete:done.size,failed:failed.size,total:urls.length,truncated})};
 function finish(url:string,ok:boolean){if(!alive||done.has(url)||failed.has(url))return;(ok?done:failed).add(url);clearTimeout(timers.get(url));const ws=sockets.get(url);if(ws){closeSocket(ws)}snapshot()}
 snapshot();if(!hex(recipient)){urls.forEach(u=>failed.add(u));snapshot();return()=>{alive=false}}
 for(const url of urls){let count=0,phase='notifications';const requested=new Set<string>();try{const ws=options.socket?options.socket(url):new WebSocket(url);sockets.set(url,ws);timers.set(url,setTimeout(()=>finish(url,false),options.timeoutMs??12000));
 ws.onopen=()=>{try{ws.send(JSON.stringify(['REQ',sub,{kinds:[1,6,7],'#p':[recipient],limit:200}]))}catch{finish(url,false)}};
 ws.onerror=ws.onclose=()=>finish(url,false);
 ws.onmessage=m=>{if(!alive||done.has(url)||failed.has(url)||typeof m.data!=='string'||m.data.length>65536)return;try{const a=JSON.parse(m.data);if(!Array.isArray(a)||![sub,targetSub].includes(a[1]))return;if(a[0]==='CLOSED'){finish(url,false);return}if(a[0]==='EOSE'){if(a[1]===sub&&phase==='notifications'){phase='targets';const ids=[...new Set([...raw.values()].map(notificationTarget).filter((id):id is string=>Boolean(id)))].filter(id=>!targets.has(id)).slice(0,200);if(!ids.length){finish(url,true);return}ids.forEach(id=>requested.add(id));ws.send(JSON.stringify(['REQ',targetSub,{kinds:[1],ids,limit:200}]))}else if(a[1]===targetSub)finish(url,true);return}if(a[0]!=='EVENT')return;if(++count>600){truncated=true;finish(url,false);return}const e=a[2] as Event;if(!valid(e))return;if(a[1]===targetSub){if(e.kind===1&&requested.has(e.id)){targets.set(e.id,e);snapshot()}return}if(![1,6,7].includes(e.kind)||!e.tags.some(t=>t[0]==='p'&&t[1]===recipient)||e.pubkey===recipient)return;if(raw.size>=500&&!raw.has(e.id)){truncated=true;return}raw.set(e.id,e);if(raw.size>=200)truncated=true;snapshot()}catch{}};
 }catch{finish(url,false)}}
 return()=>{alive=false;for(const t of timers.values())clearTimeout(t);for(const ws of sockets.values()){closeSocket(ws)}};
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
