import type {Event} from 'nostr-tools';
import {RelayConnections} from './relay-connections';
import {ReactionState, ReactionWriter, type ReactionTarget} from './reactions';

type Query = {kind:'reactions'|'deletions'|'live'; ids:string[]; done:boolean; count:number; timer?:ReturnType<typeof setTimeout>};
type Reader = {socket:WebSocket; queries:Map<string,Query>; checked:Set<string>; queued:Set<string>; failed:boolean; deletionBusy:boolean};
export type ReactionSnapshot = {events:Event[]; loading:boolean; partial:boolean; available:boolean};
const empty:ReactionSnapshot = {events:[],loading:false,partial:false,available:false};
/** Batched read-only subscriptions for mounted notes, with exact deletion history lookups. */
export class ReactionSession {
  readonly state:ReactionState;
  readonly writer:ReactionWriter;
  abort = new AbortController();
  private targets = new Map<string,{target:ReactionTarget; listeners:Set<()=>void>}>();
  private readers = new Map<string,Reader>();
  private snapshots = new Map<string,ReactionSnapshot>();
  private connections:RelayConnections;
  private sequence = 0;
  private syncTimer?:ReturnType<typeof setTimeout>;
  private refreshTimer?:ReturnType<typeof setInterval>;
  private started = false;
  private unavailable = new Set<string>();
  constructor(readonly owner:string, private urls:string[], socket?:(url:string)=>WebSocket, private timeout=10000) {
    this.state = new ReactionState(owner); this.writer = new ReactionWriter(this.state);
    this.connections = new RelayConnections({
      status:()=>{}, changed:()=>{},
      open:ws => {
        const previous=this.readers.get(ws.url);if(previous)for(const q of previous.queries.values())clearTimeout(q.timer);
        const reader:Reader = {socket:ws,queries:new Map(),checked:new Set(),queued:new Set(),failed:false,deletionBusy:false};
        this.readers.set(ws.url,reader);this.unavailable.delete(ws.url);
        this.request(reader,'live',[],Math.floor(Date.now()/1000)-600);
        this.sync(reader); this.emit();
      },
      disconnected:url => {this.unavailable.add(url);const reader=this.readers.get(url); if(reader){reader.failed=true;for(const q of reader.queries.values()){clearTimeout(q.timer);q.done=true}}this.emit()},
      message:(ws,_config,_message,frame) => this.receive(ws,frame),
    },socket);
  }
  start() {
    if (this.started || !this.owner) return;
    if(this.abort.signal.aborted)this.abort=new AbortController();
    this.started=true;
    this.connections.start(this.urls.map(url => ({url,read:true,write:false})));
    this.refreshTimer=setInterval(() => this.refresh(),30000);
  }
  stop() {
    this.started=false;this.abort.abort();clearTimeout(this.syncTimer);clearInterval(this.refreshTimer);
    for(const reader of this.readers.values()) for(const q of reader.queries.values()) clearTimeout(q.timer);
    this.connections.stop();this.readers.clear();
  }
  watch(target:ReactionTarget, listener:()=>void) {
    let entry=this.targets.get(target.id);
    if(!entry){entry={target,listeners:new Set()};this.targets.set(target.id,entry)}
    entry.listeners.add(listener);this.schedule();
    return () => {entry.listeners.delete(listener);if(!entry.listeners.size){this.targets.delete(target.id);this.snapshots.delete(target.id);this.schedule()}};
  }
  snapshot(id:string) { return this.snapshots.get(id) ?? empty; }
  refresh() {
    for(const url of this.unavailable)this.connections.restart(url);
    for(const reader of this.readers.values()) if(reader.socket.readyState===1){reader.failed=false;for(const id of reader.queries.keys())this.close(reader,id);reader.deletionBusy=false;reader.checked.clear();reader.queued.clear();this.request(reader,'live',[],Math.floor(Date.now()/1000)-600);this.sync(reader)}
    this.emit();
  }
  emit() {
    const readers=[...this.readers.values()];
    const loading=!!this.owner && this.urls.length>0 && (readers.length+this.unavailable.size<this.urls.length || readers.some(r=>!r.failed&&([...r.queries.values()].some(q=>!q.done)||r.queued.size>0)));
    const partial=!!this.owner && (!this.urls.length || this.unavailable.size>0 || readers.some(r=>r.failed) || this.targets.size>1200 || this.state.events.size>=10000 || this.state.deleted.size>=20000);
    const observed=new Set([...this.targets.keys()].slice(0,1200));
    const hasReader=readers.some(r=>!r.failed&&[...r.queries.values()].some(q=>q.kind==='reactions'&&q.done));
    for(const [id,entry] of this.targets){
      const available=hasReader&&observed.has(id);
      const events=this.state.forTarget(entry.target),old=this.snapshots.get(id);
      if(old&&old.loading===loading&&old.partial===partial&&old.available===available&&old.events.length===events.length&&old.events.every((e,i)=>e.id===events[i].id))continue;
      this.snapshots.set(id,{events,loading,partial,available});for(const listener of entry.listeners)listener();
    }
  }
  private schedule() {
    clearTimeout(this.syncTimer);this.syncTimer=setTimeout(()=>{for(const r of this.readers.values())if(!r.failed)this.sync(r);this.emit()},80);
  }
  private close(reader:Reader,id:string) {
    const q=reader.queries.get(id);clearTimeout(q?.timer);reader.queries.delete(id);
    this.connections.send(reader.socket,JSON.stringify(['CLOSE',id]));
  }
  private request(reader:Reader,kind:Query['kind'],ids:string[],since?:number) {
    const id=`reaction-${++this.sequence}`;
    const query:Query={kind,ids,done:kind==='live',count:0};reader.queries.set(id,query);
    const filter={authors:[this.owner],kinds:[kind==='reactions'?7:5],...(kind==='live'?{since}:{'#e':ids,limit:1000})};
    query.timer=setTimeout(()=>{if(query.done)return;query.done=true;reader.failed=true;this.emit()},this.timeout);
    if(!this.connections.send(reader.socket,JSON.stringify(['REQ',id,filter]))){query.done=true;reader.failed=true}
  }
  private sync(reader:Reader) {
    for(const [id,q] of reader.queries)if(q.kind==='reactions')this.close(reader,id);
    const ids=[...this.targets.keys()].slice(0,1200);
    for(let i=0;i<ids.length;i+=100)this.request(reader,'reactions',ids.slice(i,i+100));
    for(const e of this.state.events.values())if(!reader.checked.has(e.id))reader.queued.add(e.id);
    this.deletions(reader);
  }
  private deletions(reader:Reader) {
    for(const id of reader.queued)if(reader.checked.has(id))reader.queued.delete(id);
    if(reader.deletionBusy||!reader.queued.size||reader.failed)return;
    const ids=[...reader.queued].slice(0,100);for(const id of ids)reader.queued.delete(id);
    reader.deletionBusy=true;this.request(reader,'deletions',ids);
  }
  private receive(ws:WebSocket,frame:unknown[]) {
    if(this.abort.signal.aborted)return;
    const reader=this.readers.get(ws.url),id=String(frame[1]);
    if(!reader||reader.socket!==ws)return;
    const query=reader.queries.get(id);if(!query)return;
    if(frame[0]==='CLOSED'){reader.failed=true;query.done=true;clearTimeout(query.timer);this.emit();return}
    if(frame[0]==='EOSE'){
      query.done=true;clearTimeout(query.timer);
      if(query.kind==='deletions'){for(const key of query.ids)reader.checked.add(key);this.close(reader,id);reader.deletionBusy=false;this.deletions(reader)}
      this.emit();return;
    }
    if(frame[0]!=='EVENT')return;
    if(!query.done&&++query.count>=1000&&query.kind!=='live'){reader.failed=true;query.done=true;this.close(reader,id)}
    const event=frame[2] as Event;
    if(event.kind===7){
      const targetId=event.tags.filter(t=>t[0]==='e').at(-1)?.[1];
      const target=targetId?this.targets.get(targetId)?.target:undefined;
      if(!target||!this.state.receive(event,target))return;
      for(const r of this.readers.values())if(!r.checked.has(event.id)){r.queued.add(event.id);this.deletions(r)}
    }else if(event.kind===5)this.state.receive(event);
    this.emit();
  }
}
