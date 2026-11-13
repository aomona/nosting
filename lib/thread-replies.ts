import {verifyEvent,type Event} from 'nostr-tools';
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** NIP-10 marked replies, then deprecated positional tags. Mentions are not replies. */
export function replyParent(tags:string[][]):string|null{
 const es=tags.filter(t=>Array.isArray(t)&&t[0]==='e');
 const replies=es.filter(t=>t[3]==='reply');
 if(replies.length)return replies.every(t=>hex(t[1]))&&new Set(replies.map(t=>t[1])).size===1?replies[0][1]:null;
 const roots=es.filter(t=>t[3]==='root');
 if(roots.length)return roots.every(t=>hex(t[1]))&&new Set(roots.map(t=>t[1])).size===1?roots[0][1]:null;
 // Marked events must not fall back to positional interpretation.
 if(es.some(t=>Boolean(t[3])))return null;
 const last=es.at(-1)?.[1];return hex(last)?last:null;
}
export type ReplySnapshot={events:Event[];complete:number;failed:number;total:number;truncated:boolean;loading:boolean};
export function watchReplies(target:string,relays:string[],update:(s:ReplySnapshot)=>void,options:{timeoutMs?:number;socket?:(url:string)=>WebSocket}={}){
 let alive=true;const found=new Map<string,Event>(),done=new Set<string>(),failed=new Set<string>();let truncated=false;
 const urls=[...new Set(relays)].filter(url=>{try{const u=new URL(url);return u.protocol==='wss:'&&!u.username&&!u.password&&!u.hash}catch{return false}}).slice(0,16);
 const sockets=new Map<string,WebSocket>(),timers=new Map<string,ReturnType<typeof setTimeout>>();
 const snapshot=()=>{if(alive)update({events:[...found.values()].sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id)),complete:done.size,failed:failed.size,total:urls.length,truncated,loading:done.size+failed.size<urls.length})};
 const sub='thread-'+Math.random().toString(36).slice(2);
 function finish(url:string,success:boolean){if(!alive||done.has(url)||failed.has(url))return;(success?done:failed).add(url);clearTimeout(timers.get(url));const ws=sockets.get(url);if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',sub]));ws.close()}catch{}}snapshot()}
 snapshot();
 if(!hex(target)){for(const url of urls)failed.add(url);snapshot();return()=>{alive=false}}
 for(const url of urls){let count=0;try{const ws=options.socket?options.socket(url):new WebSocket(url);sockets.set(url,ws);timers.set(url,setTimeout(()=>finish(url,false),options.timeoutMs??12000));
 ws.onopen=()=>{try{ws.send(JSON.stringify(['REQ',sub,{kinds:[1],'#e':[target],limit:200}]))}catch{finish(url,false)}};
 ws.onerror=ws.onclose=()=>finish(url,false);
 ws.onmessage=message=>{if(!alive||done.has(url)||failed.has(url))return;if(typeof message.data!=='string'||message.data.length>65536)return;try{const m=JSON.parse(message.data);if(!Array.isArray(m)||m[1]!==sub)return;if(m[0]==='EOSE'){finish(url,true);return}if(m[0]==='CLOSED'){finish(url,false);return}if(m[0]!=='EVENT')return;if(++count>400){truncated=true;finish(url,false);return}if(count>=200)truncated=true;
 const e=m[2] as Event;if(e?.kind!==1||typeof e.content!=='string'||e.content.length>10000||!Array.isArray(e.tags)||e.tags.length>2000||!Number.isSafeInteger(e.created_at)||e.created_at<0||e.created_at>Date.now()/1000+60||e.id===target||found.has(e.id)||replyParent(e.tags)!==target||!verifyEvent(e))return;
 if(found.size>=500){truncated=true;return}found.set(e.id,e);snapshot();}catch{}};
 }catch{finish(url,false)}}
 return()=>{alive=false;for(const t of timers.values())clearTimeout(t);for(const ws of sockets.values()){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',sub]));ws.close()}catch{}}};
}
