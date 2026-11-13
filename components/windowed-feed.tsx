'use client';
import {Component,createContext,memo,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import './windowed-feed.css';

export type FeedAnchor={id:string;offset:number};
type Anchor=FeedAnchor|null;
type RecordEntry={element:HTMLDivElement;notify:()=>void;near:boolean;height:number;retained:number};
type Manager={rows:Map<string,RecordEntry>;io:IntersectionObserver|null;ro:ResizeObserver|null;enabled:boolean;forced:boolean;pins:ReadonlySet<string>;focus:string|null;selection:Set<string>;anchor:Anchor;programmaticScrollY:number|null;read:()=>Anchor;restore:(a:Anchor)=>void;update:()=>void};
const RetentionContext=createContext<((active:boolean)=>()=>void)|null>(null);
/** Pin the current row while local child state must not be discarded. */
export function useRowRetention(active:boolean){const retain=useContext(RetentionContext);useLayoutEffect(()=>active&&retain?retain(true):undefined,[active,retain])}
// Estimate only until the shared observer measures a mounted row.
export const ESTIMATED_ROW_HEIGHT=220;
export function initialRowGeometry(windowed:boolean){return windowed?{near:false,height:ESTIMATED_ROW_HEIGHT}:{near:true,height:0}}
export function shouldKeepRow(enabled:boolean,near:boolean,height:number,pinned:boolean){return !enabled||near||height<=0||pinned}
export function selectionRange(ids:readonly string[],start:string|null,end:string|null){if(!start||!end)return new Set<string>();const a=ids.indexOf(start),b=ids.indexOf(end);return a<0||b<0?new Set<string>():new Set(ids.slice(Math.min(a,b),Math.max(a,b)+1))}
function notifyChangedRows(manager:Manager,old:ReadonlySet<string>,next:ReadonlySet<string>){for(const id of old)if(!next.has(id))manager.rows.get(id)?.notify();for(const id of next)if(!old.has(id))manager.rows.get(id)?.notify()}
function createManager():Manager{
 const m:Manager={rows:new Map(),io:null,ro:null,enabled:false,forced:false,pins:new Set(),focus:null,selection:new Set(),anchor:null,programmaticScrollY:null,read:()=>null,restore:()=>{},update:()=>{}};
 m.read=()=>{let best:{id:string;offset:number}|null=null;for(const [id,r]of m.rows){if(!r.near)continue;const rect=r.element.getBoundingClientRect();if(rect.bottom>0&&rect.top<innerHeight&&(!best||rect.top<best.offset))best={id,offset:rect.top}}return best};
 m.restore=a=>{if(!a)return;const row=m.rows.get(a.id);if(!row)return;const delta=row.element.getBoundingClientRect().top-a.offset;if(Math.abs(delta)>.5){window.scrollBy({top:delta,behavior:'instant'});m.programmaticScrollY=window.scrollY}m.anchor=m.read()};
 m.update=()=>{for(const row of m.rows.values())row.notify()};return m;
}
/** Snapshot before parent-driven prepend/mode/width changes; never discard rows. */
class AnchorBoundary extends Component<{manager:Manager;children:ReactNode}>{
 private wasWindowed=false;
 componentDidMount(){this.wasWindowed=this.props.manager.enabled}
 getSnapshotBeforeUpdate(){return this.wasWindowed||this.props.manager.enabled?this.props.manager.read():null}
 componentDidUpdate(_prev:unknown,_state:unknown,snapshot:Anchor){if(snapshot)this.props.manager.restore(snapshot);this.wasWindowed=this.props.manager.enabled}
 render(){return this.props.children}
}
const RowSlot=memo(function RowSlot({id,children,manager}:{id:string;children:ReactNode;manager:Manager}){
 const element=useRef<HTMLDivElement>(null),[,rerender]=useState(0);const notify=useRef(()=>rerender(v=>v+1));
 const record=useMemo<RecordEntry>(()=>({element:null!,notify:()=>notify.current(),...initialRowGeometry(manager.enabled&&!manager.forced),retained:0}),[]);
 useLayoutEffect(()=>{record.element=element.current!;manager.rows.set(id,record);record.height=record.element.getBoundingClientRect().height;manager.io?.observe(record.element);manager.ro?.observe(record.element);return()=>{manager.io?.unobserve(record.element);manager.ro?.unobserve(record.element);manager.rows.delete(id)}},[id,manager,record]);
 const retain=useMemo(()=>()=>{record.retained++;record.notify();let released=false;return()=>{if(released)return;released=true;record.retained=Math.max(0,record.retained-1);record.notify()}},[record]);
 const pinned=manager.pins.has(id)||manager.focus===id||manager.selection.has(id)||record.retained>0;
 const show=shouldKeepRow(manager.enabled&&!manager.forced,record.near,record.height,pinned);
 return <div ref={element} data-window-row={id} className="petal-window-row" aria-hidden={show?undefined:true} style={show?undefined:{height:record.height}}><RetentionContext.Provider value={retain}>{show?children:null}</RetentionContext.Provider></div>
});
export default function WindowedFeed<T extends {id:string}>({items,renderItem,enabled=false,pinnedIds,onFallback,restoreAnchor}:{items:readonly T[];renderItem:(item:T)=>ReactNode;enabled?:boolean;pinnedIds?:ReadonlySet<string>;onFallback?:()=>void;restoreAnchor?:FeedAnchor|null}){
 const manager=useMemo(()=>{const m=createManager();if(enabled&&restoreAnchor)m.focus=restoreAnchor.id;return m},[]),[forced,setForced]=useState(false),root=useRef<HTMLDivElement>(null),fallback=useRef(onFallback);fallback.current=onFallback;
 manager.enabled=enabled;manager.forced=forced;manager.pins=pinnedIds??EMPTY;
 useLayoutEffect(()=>{setForced(false);manager.forced=false;manager.update()},[enabled,manager]);
 const previousPins=useRef<ReadonlySet<string>>(EMPTY);
 useLayoutEffect(()=>{if(manager.enabled&&!manager.forced)notifyChangedRows(manager,previousPins.current,manager.pins);previousPins.current=manager.pins},[pinnedIds,manager]);
 // History return uses event identity, never an obsolete absolute scroll offset.
 useLayoutEffect(()=>{
  if(!restoreAnchor||!Number.isFinite(restoreAnchor.offset))return;
  const row=manager.rows.get(restoreAnchor.id);if(!row)return;
  row.near=true;manager.focus=restoreAnchor.id;row.notify();
  let cancelled=false;
  const restore=()=>{if(cancelled||manager.rows.get(restoreAnchor.id)!==row)return;manager.restore(restoreAnchor);const article=row.element.querySelector<HTMLElement>('[data-note-id],article[tabindex],[tabindex]');article?.focus({preventScroll:true})};
  // First mount has all children; a previously collapsed row needs its update first.
  if(row.element.getAttribute('aria-hidden')!=='true')restore();
  const frame=requestAnimationFrame(restore);
  return()=>{cancelled=true;cancelAnimationFrame(frame)};
 },[restoreAnchor,manager]);
 useEffect(()=>{
  if(typeof IntersectionObserver==='undefined'||typeof ResizeObserver==='undefined'){setForced(true);fallback.current?.();return}
  manager.io=new IntersectionObserver(entries=>{const anchor=manager.read(),changed:RecordEntry[]=[];for(const entry of entries){const row=manager.rows.get((entry.target as HTMLElement).dataset.windowRow!);if(row&&row.near!==entry.isIntersecting){if(!entry.isIntersecting&&row.element.getAttribute('aria-hidden')!=='true'){const measured=row.element.getBoundingClientRect().height;if(measured>0)row.height=measured}row.near=entry.isIntersecting;changed.push(row)}}if(changed.length&&manager.enabled&&!manager.forced){flushSync(()=>changed.forEach(row=>row.notify()));manager.restore(anchor)}},{rootMargin:'1200px 0px'});
  let rootWidth=root.current?.getBoundingClientRect().width??0;
  manager.ro=new ResizeObserver(entries=>{const anchor=manager.anchor;let changed=false;for(const entry of entries){if(entry.target===root.current){const width=entry.contentRect.width;if(rootWidth&&Math.abs(width-rootWidth)>.5)resize();rootWidth=width;continue}const row=manager.rows.get((entry.target as HTMLElement).dataset.windowRow!);if(!row||row.element.getAttribute('aria-hidden')==='true')continue;const height=entry.borderBoxSize?.[0]?.blockSize??row.element.getBoundingClientRect().height;if(height>0&&Math.abs(row.height-height)>.5){row.height=height;changed=true}}if(changed&&manager.enabled){manager.restore(anchor)}manager.anchor=manager.read()});
  for(const r of manager.rows.values()){manager.io.observe(r.element);manager.ro.observe(r.element)}if(root.current)manager.ro.observe(root.current);
  let raf=0;const scroll=()=>{if(manager.programmaticScrollY!==null&&Math.abs(window.scrollY-manager.programmaticScrollY)<1){manager.programmaticScrollY=null;return}manager.programmaticScrollY=null;manager.anchor=null;cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{manager.anchor=manager.read()})};
  const rowId=(node:Node|null)=>{const element=node instanceof Element?node:node?.parentElement;const row=element?.closest<HTMLElement>('[data-window-row]');return row&&root.current?.contains(row)?row.dataset.windowRow??null:null};
  const focus=()=>{queueMicrotask(()=>{const old=manager.focus;manager.focus=rowId(document.activeElement);if(manager.enabled&&!manager.forced&&old!==manager.focus){if(old)manager.rows.get(old)?.notify();if(manager.focus)manager.rows.get(manager.focus)?.notify()}})};
  const selection=()=>{const old=manager.selection;const s=window.getSelection();manager.selection=s&&!s.isCollapsed?selectionRange(Array.from(root.current?.querySelectorAll<HTMLElement>('[data-window-row]')??[]).map(row=>row.dataset.windowRow!),rowId(s.anchorNode),rowId(s.focusNode)):new Set();if(manager.enabled&&!manager.forced)notifyChangedRows(manager,old,manager.selection)};
  const tab=(event:KeyboardEvent)=>{if(event.key==='Tab'&&manager.enabled&&!manager.forced){manager.forced=true;flushSync(()=>{setForced(true);manager.update()});fallback.current?.()}};
  const resize=()=>{if(!manager.enabled||manager.forced)return;const anchor=manager.anchor;manager.forced=true;flushSync(()=>{setForced(true);manager.update()});manager.restore(anchor);fallback.current?.()};
  document.fonts?.addEventListener('loadingdone',resize);window.addEventListener('resize',resize);window.addEventListener('scroll',scroll,{passive:true});document.addEventListener('focusin',focus);document.addEventListener('focusout',focus);document.addEventListener('selectionchange',selection);document.addEventListener('keydown',tab,true);manager.anchor=manager.read();
  return()=>{manager.io?.disconnect();manager.ro?.disconnect();manager.io=manager.ro=null;cancelAnimationFrame(raf);document.fonts?.removeEventListener('loadingdone',resize);window.removeEventListener('resize',resize);window.removeEventListener('scroll',scroll);document.removeEventListener('focusin',focus);document.removeEventListener('focusout',focus);document.removeEventListener('selectionchange',selection);document.removeEventListener('keydown',tab,true)};
 },[manager]);
 return <AnchorBoundary manager={manager}><div ref={root} className={`petal-windowed-feed${enabled&&!forced?' is-windowed':''}`}>{items.map(item=><RowSlot key={item.id} id={item.id} manager={manager}>{renderItem(item)}</RowSlot>)}</div></AnchorBoundary>
}
const EMPTY:ReadonlySet<string>=new Set();
