import {nip19,verifyEvent,type Event} from 'nostr-tools';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
export function quoteIds(content:string,tags:string[][]=[],ownId=''){
 const ids=new Set<string>();const add=(id:string)=>{if(/^[a-f0-9]{64}$/.test(id)&&id!==ownId&&ids.size<3)ids.add(id)};
 for(const tag of tags)if(tag[0]==='q')add(tag[1]||'');
 function text(value:string){for(const m of value.matchAll(/(?:nostr:)?\b((?:nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi)){try{const decoded=nip19.decode(m[1]);if(decoded.type==='note')add(decoded.data);else if(decoded.type==='nevent')add(decoded.data.id)}catch{}}}
 function walk(node:any){if(['code','inlineCode','html','image','imageReference'].includes(node.type))return;if(node.type==='text')text(node.value||'');if(node.type==='link')text(node.url||'');node.children?.forEach(walk)}
 walk(unified().use(remarkParse).parse(content));return [...ids];
}
/** Standalone reference paragraphs are replaced by their cards, never code. */
export function quoteDisplayContent(content:string,ids:string[]){
 if(!ids.length)return content;const shown=new Set(ids);const ranges:{start:number;end:number;text:string}[]=[];
 const referenceLine=(line:string)=>{const tokens=line.trim().split(/\s+/);return tokens.length>0&&tokens.every(token=>{try{const d=nip19.decode(token.replace(/^nostr:/i,''));return shown.has(d.type==='note'?d.data:d.type==='nevent'?d.data.id:'')}catch{return false}})};
 for(const node of unified().use(remarkParse).parse(content).children){
  if(node.type!=='paragraph'||!node.children.every(n=>n.type==='text'))continue;
  const start=node.position?.start.offset,end=node.position?.end.offset;if(start===undefined||end===undefined)continue;
  const raw=content.slice(start,end);const text=raw.split('\n').filter(line=>!referenceLine(line)).join('\n');if(text!==raw)ranges.push({start,end,text});
 }
 let result=content;for(const r of ranges.reverse())result=result.slice(0,r.start)+r.text+result.slice(r.end);return result.trim();
}
export type QuoteResult={event?:Event;error?:string};
type Socket=Pick<WebSocket,'url'|'readyState'|'send'>;
type Task={id:string;subscription:string;resolve:(r:QuoteResult)=>void;promise:Promise<QuoteResult>;sockets:Socket[];pending:Set<string>;timer?:ReturnType<typeof setTimeout>};
let serial=0;
export class QuoteResolver {
 private cache=new Map<string,Event>();private tasks=new Map<string,Task>();private active=new Map<string,Task>();private queue:Task[]=[];
 constructor(private sockets:()=>Socket[],private readUrls:()=>string[],private timeout=8000){}
 request(id:string):Promise<QuoteResult>{
  if(!/^[a-f0-9]{64}$/.test(id))return Promise.resolve({error:'引用IDが不正です'});
  const cached=this.cache.get(id);if(cached){this.cache.delete(id);this.cache.set(id,cached);return Promise.resolve({event:cached})}
  const old=this.tasks.get(id);if(old)return old.promise;
  if(this.tasks.size>=200)return Promise.resolve({error:'引用の読み込みが混み合っています'});
  let resolve!:(r:QuoteResult)=>void;const promise=new Promise<QuoteResult>(r=>resolve=r);
  const task:Task={id,subscription:'quote-'+(++serial),resolve,promise,sockets:[],pending:new Set()};this.tasks.set(id,task);task.timer=setTimeout(()=>this.finish(task,{error:'引用の読み込みがタイムアウトしました'}),this.timeout);this.queue.push(task);this.pump();return promise;
 }
 private finish(task:Task,result:QuoteResult){if(this.tasks.get(task.id)!==task)return;clearTimeout(task.timer);this.tasks.delete(task.id);this.active.delete(task.subscription);for(const ws of task.sockets)try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',task.subscription]))}catch{}if(result.event){this.cache.set(task.id,result.event);while(this.cache.size>200)this.cache.delete(this.cache.keys().next().value!)}task.resolve(result);this.pump();}
 private pump(){while(this.active.size<6&&this.queue.length){const t=this.queue.shift()!;if(this.tasks.get(t.id)!==t)continue;const allowed=new Set(this.readUrls());t.sockets=this.sockets().filter(ws=>ws.readyState===1&&allowed.has(ws.url));t.pending=new Set(t.sockets.map(s=>s.url));this.active.set(t.subscription,t);if(!t.pending.size){this.finish(t,{error:'読み取りリレーに接続できていません'});continue}for(const ws of t.sockets){if(!this.active.has(t.subscription))break;try{ws.send(JSON.stringify(['REQ',t.subscription,{ids:[t.id],kinds:[1],limit:1}]))}catch{t.pending.delete(ws.url)}}if(this.active.has(t.subscription)&&!t.pending.size)this.finish(t,{error:'引用を取得できませんでした'});}}
 receive(url:string,m:unknown[]){const t=this.active.get(String(m[1]));if(!t||!t.pending.has(url))return false;if(m[0]==='EVENT'){const e=m[2] as Event;try{if(e?.id===t.id&&e.kind===1&&typeof e.content==='string'&&e.content.length<=10000&&verifyEvent(e))this.finish(t,{event:e})}catch{}}else if(m[0]==='EOSE'||m[0]==='CLOSED'){t.pending.delete(url);if(!t.pending.size)this.finish(t,{error:'設定中のリレーで引用が見つかりませんでした'})}return true;}
 disconnect(url:string){for(const t of [...this.active.values()])if(t.pending.delete(url)&&!t.pending.size)this.finish(t,{error:'引用の取得中に接続が切れました'});}
 reset(){this.queue=[];const old=[...this.tasks.values()];this.tasks.clear();this.active.clear();this.cache.clear();for(const t of old){clearTimeout(t.timer);for(const ws of t.sockets)try{ws.send(JSON.stringify(['CLOSE',t.subscription]))}catch{}t.resolve({error:'接続設定が変更されました'})}}
}
