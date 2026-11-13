import type {RelayConfig} from './relays';
// Application acceptance limits, not claims about protocol-wide Nostr limits.
export const MAX_RELAY_FRAME_BYTES=2*1024*1024;
export function parseRelayFrame(data:unknown):unknown[]|null{
 if(typeof data!=='string'||data.length>MAX_RELAY_FRAME_BYTES||new TextEncoder().encode(data).byteLength>MAX_RELAY_FRAME_BYTES)return null;
 try{const frame=JSON.parse(data);return Array.isArray(frame)&&frame.length>=2&&frame.length<=4&&typeof frame[0]==='string'&&typeof frame[1]==='string'&&frame[1].length<=256?frame:null}catch{return null}
}
export function validInboundEvent(value:any,now=Math.floor(Date.now()/1000)):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value)||! /^[a-f0-9]{64}$/.test(value.id)||! /^[a-f0-9]{64}$/.test(value.pubkey)||! /^[a-f0-9]{128}$/.test(value.sig))return false;
 if(!Number.isSafeInteger(value.kind)||value.kind<0||value.kind>65535||!Number.isSafeInteger(value.created_at)||value.created_at<0||value.created_at>now+600||typeof value.content!=='string'||value.content.length>(value.kind===0?20000:value.kind===1?10000:200000))return false;
 if(!Array.isArray(value.tags)||value.tags.length>(value.kind===3?20000:4096))return false;let chars=0;
 for(const tag of value.tags){if(!Array.isArray(tag)||tag.length>64)return false;for(const item of tag){if(typeof item!=='string'||item.length>8192)return false;chars+=item.length;if(chars>(value.kind===3?1800000:262144))return false}}
 return true;
}
export function matchesRelayFilter(event:any,filter:any):boolean{
 if(!filter||typeof filter!=='object'||Array.isArray(filter))return false;
 if(filter.kinds&&!filter.kinds.includes(event.kind))return false;
 if(filter.authors&&!filter.authors.some((key:string)=>event.pubkey.startsWith(key)))return false;
 if(filter.ids&&!filter.ids.some((id:string)=>event.id.startsWith(id)))return false;
 if(filter.since!==undefined&&event.created_at<filter.since||filter.until!==undefined&&event.created_at>filter.until)return false;
 for(const [key,values]of Object.entries(filter)){if(key.startsWith('#')&&Array.isArray(values)&&!event.tags.some((tag:string[])=>tag[0]===key.slice(1)&&values.includes(tag[1])))return false}
 // NIP50 tokenization belongs to the relay. Never literal-filter its search term.
 return true;
}
export type RelaySocket=Pick<WebSocket,'url'|'readyState'|'send'|'close'|'onopen'|'onclose'|'onerror'|'onmessage'>;
type Callbacks={status:(url:string,status:string)=>void;changed:(sockets:WebSocket[])=>void;open:(socket:WebSocket,config:RelayConfig)=>void;message:(socket:WebSocket,config:RelayConfig,event:MessageEvent,frame:unknown[])=>void;disconnected:(url:string)=>void};
type Entry={config:RelayConfig;socket?:WebSocket;attempt:number;timer?:ReturnType<typeof setTimeout>;deadline?:ReturnType<typeof setTimeout>;failed:boolean};
export function reconnectDelay(base:number,random:()=>number=Math.random){const sample=random();return Math.round(base*(.8+.4*(Number.isFinite(sample)?Math.max(0,Math.min(1,sample)):.5)))}
/** Each relay owns its failures/timers. Old sockets can never affect a new run. */
export class RelayConnections {
 private entries=new Map<string,Entry>();private epoch=0;
 constructor(private callbacks:Callbacks,private create:(url:string)=>WebSocket=url=>new WebSocket(url),private delays=[1000,2000,4000],private timeout=12000,private random:()=>number=Math.random){}
 stop(){this.epoch++;const old=[...this.entries.values()];this.entries.clear();for(const e of old){clearTimeout(e.timer);clearTimeout(e.deadline);try{e.socket?.close()}catch{}}this.callbacks.changed([]);}
 start(config:RelayConfig[]){this.stop();const epoch=this.epoch;for(const c of config){if(!c.read&&!c.write){this.callbacks.status(c.url,'無効');continue}const e:Entry={config:c,attempt:0,failed:false};this.entries.set(c.url,e);this.open(e,epoch);}}
 /** Manual reset replaces only the failed entry: other subscriptions and data survive. */
 restart(url:string){const old=this.entries.get(url);if(!old||!old.failed)return false;clearTimeout(old.timer);clearTimeout(old.deadline);const fresh:Entry={config:old.config,attempt:0,failed:false};this.entries.set(url,fresh);try{old.socket?.close()}catch{}this.open(fresh,this.epoch);return true;}
 private current(e:Entry,epoch:number,ws?:WebSocket){return this.epoch===epoch&&this.entries.get(e.config.url)===e&&(!ws||e.socket===ws)&&!e.failed;}
 private changed(){this.callbacks.changed([...this.entries.values()].flatMap(e=>e.socket&&!e.failed?[e.socket]:[]));}
 private fail(e:Entry,epoch:number,ws?:WebSocket){if(!this.current(e,epoch,ws))return;e.failed=true;clearTimeout(e.deadline);this.callbacks.disconnected(e.config.url);try{e.socket?.close()}catch{}this.changed();if(e.attempt<this.delays.length){const delay=reconnectDelay(this.delays[e.attempt++],this.random);this.callbacks.status(e.config.url,`再接続待ち (${e.attempt}/${this.delays.length})`);e.timer=setTimeout(()=>{if(this.epoch===epoch&&this.entries.get(e.config.url)===e)this.open(e,epoch)},delay)}else this.callbacks.status(e.config.url,'接続失敗');}
 private open(e:Entry,epoch:number){e.failed=false;this.callbacks.status(e.config.url,'接続中');let ws:WebSocket;try{ws=this.create(e.config.url);e.socket=ws;}catch{this.fail(e,epoch);return}const subscriptions=new Map<string,unknown[]>();const nativeSend=ws.send.bind(ws);
 ws.send=(frame)=>{if(!this.current(e,epoch,ws))throw Error('stale relay socket');let m:any;try{m=JSON.parse(String(frame))}catch{throw Error('invalid outgoing frame')}
 if(m[0]==='REQ'){if(!e.config.read)throw Error('read disabled');if(typeof m[1]!=='string'||m.length<3)throw Error('invalid subscription');subscriptions.set(m[1],m.slice(2))}
 if(m[0]==='CLOSE')subscriptions.delete(m[1]);if(m[0]==='EVENT'&&!e.config.write)throw Error('write disabled');
 try{nativeSend(frame)}catch(error){if(m[0]==='REQ')subscriptions.delete(m[1]);throw error}};
 this.changed();e.deadline=setTimeout(()=>this.fail(e,epoch,ws),this.timeout);
 ws.onopen=()=>{if(!this.current(e,epoch,ws))return;clearTimeout(e.deadline);this.callbacks.status(e.config.url,'接続済み');try{this.callbacks.open(ws,e.config)}catch{this.fail(e,epoch,ws)}};
 ws.onmessage=event=>{if(!this.current(e,epoch,ws))return;try{const frame=parseRelayFrame(event.data);if(!frame)return;const type=frame[0],id=frame[1] as string;if(type==='EVENT'){if(!e.config.read||frame.length!==3||!validInboundEvent(frame[2]))return;const filters=subscriptions.get(id);if(!filters||!filters.some(f=>matchesRelayFilter(frame[2],f)))return;}else if(type==='EOSE'||type==='CLOSED'){if(!subscriptions.has(id))return;if(type==='CLOSED')subscriptions.delete(id);}else if(type!=='OK')return;this.callbacks.message(ws,e.config,event,frame)}catch{/* malformed relay payload cannot interrupt another connection */}};
 ws.onerror=()=>this.fail(e,epoch,ws);ws.onclose=()=>this.fail(e,epoch,ws);
 }
 send(ws:WebSocket,frame:string){const e=this.entries.get(ws.url);if(!e||e.socket!==ws||e.failed||ws.readyState!==1)return false;let message:unknown[];try{message=JSON.parse(frame)}catch{return false}if(message[0]==='REQ'&&!e.config.read||message[0]==='EVENT'&&!e.config.write)return false;try{ws.send(frame);return true}catch{this.fail(e,this.epoch,ws);return false}}
}
export type PublishResult={accepted:boolean;confirmed:number;total:number;unconfirmed:number};
export class RelayPublisher {
 private jobs=new Map<string,{reply:(url:string,ok:boolean)=>void;cancel:()=>void}>();
 receive(url:string,id:unknown,ok:unknown){if(typeof id==='string'&&typeof ok==='boolean')this.jobs.get(id)?.reply(url,ok);}
 cancel(){for(const job of [...this.jobs.values()])job.cancel();}
 publish(sockets:Pick<WebSocket,'url'|'readyState'|'send'>[],event:{id:string},timeout=8000):Promise<PublishResult>{
 const targets=[...new Map(sockets.filter(s=>s.readyState===1).map(s=>[s.url,s])).values()];
 return new Promise(resolve=>{const replies=new Map<string,boolean>();let finished=false,dispatching=true;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);this.jobs.delete(event.id);const confirmed=[...replies.values()].filter(Boolean).length;resolve({accepted:confirmed>0,confirmed,total:targets.length,unconfirmed:targets.length-confirmed})};const check=()=>{if(!dispatching&&([...replies.values()].some(Boolean)||replies.size===targets.length))finish()};const timer=setTimeout(finish,timeout);
 this.jobs.set(event.id,{reply:(url,ok)=>{if(finished||!targets.some(s=>s.url===url)||replies.has(url))return;replies.set(url,ok);check()},cancel:finish});
 for(const ws of targets){try{ws.send(JSON.stringify(['EVENT',event]))}catch{replies.set(ws.url,false)}}dispatching=false;check();
 });
 }
}
