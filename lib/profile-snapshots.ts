type Socket=Pick<WebSocket,'url'|'readyState'|'send'>;
type Job={key:string;id:string;timer:ReturnType<typeof setTimeout>};
type State={queue:Set<string>;active:Map<string,Job>;fresh:Map<string,{until:number;ok:boolean}>;pumping:boolean};
let sequence=0;
/** One-shot kind 0 snapshots only. Never owns feed or contacts subscriptions. */
export class ProfileSnapshots{
 private states=new Map<Socket,State>();
 constructor(private send:(socket:Socket,frame:string)=>boolean,private options={concurrency:8,queue:2048,cache:2048,ttl:300000,failureTtl:30000,timeout:10000}){}
 request(socket:Socket,key:string,force=false,priority=force):'accepted'|'fresh'|'cooldown'|'overflow'|'offline'{
  if(socket.readyState!==1||!/^[a-f0-9]{64}$/.test(key))return 'offline';
  let state=this.states.get(socket);if(!state){state={queue:new Set(),active:new Map(),fresh:new Map(),pumping:false};this.states.set(socket,state)}
  if([...state.active.values()].some(j=>j.key===key))return 'accepted';
  const stamp=state.fresh.get(key);if(!force&&stamp!==undefined&&Date.now()<stamp.until){state.fresh.delete(key);state.fresh.set(key,stamp);return stamp.ok?'fresh':'cooldown'}state.fresh.delete(key);
  if(!state.queue.has(key)&&state.queue.size>=this.options.queue){if(!priority)return 'overflow';state.queue.delete(state.queue.values().next().value!)}
  if(priority)state.queue=new Set([key,...state.queue]);else state.queue.add(key);this.pump(socket,state);return 'accepted';
 }
 private pump(socket:Socket,state:State){if(state.pumping||this.states.get(socket)!==state)return;state.pumping=true;try{while(this.states.get(socket)===state&&socket.readyState===1&&state.active.size<this.options.concurrency&&state.queue.size){const key=state.queue.values().next().value!;state.queue.delete(key);const id='profile-snapshot-'+(++sequence);const job={key,id,timer:setTimeout(()=>this.finish(socket,id,false),this.options.timeout)};state.active.set(id,job);let sent=false;try{sent=this.send(socket,JSON.stringify(['REQ',id,{kinds:[0],authors:[key],limit:1}]))}catch{}if(!sent)this.finish(socket,id,false)}}finally{state.pumping=false}}
 private finish(socket:Socket,id:string,success:boolean){const state=this.states.get(socket),job=state?.active.get(id);if(!state||!job)return;clearTimeout(job.timer);state.active.delete(id);try{this.send(socket,JSON.stringify(['CLOSE',id]))}catch{}state.fresh.delete(job.key);state.fresh.set(job.key,{until:Date.now()+(success?this.options.ttl:this.options.failureTtl),ok:success});while(state.fresh.size>this.options.cache)state.fresh.delete(state.fresh.keys().next().value!);this.pump(socket,state)}
 receive(socket:Socket,frame:unknown[]){const state=this.states.get(socket);if(typeof frame[1]!=='string'||!state?.active.has(frame[1]))return false;if(frame[0]==='EOSE'||frame[0]==='CLOSED')this.finish(socket,frame[1],frame[0]==='EOSE');return true}
 disconnect(url:string){for(const [socket,state]of this.states){if(socket.url!==url)continue;this.states.delete(socket);for(const job of state.active.values()){clearTimeout(job.timer);try{this.send(socket,JSON.stringify(['CLOSE',job.id]))}catch{}}}}
 stop(){for(const socket of [...this.states.keys()])this.disconnect(socket.url)}
 stats(){return [...this.states.values()].reduce((a,s)=>({sockets:a.sockets+1,active:a.active+s.active.size,queued:a.queued+s.queue.size,fresh:a.fresh+s.fresh.size}),{sockets:0,active:0,queued:0,fresh:0})}
}
