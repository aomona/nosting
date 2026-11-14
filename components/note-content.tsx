'use client';
import {memo,useCallback,useEffect,useId,useMemo,useRef,useState,type CSSProperties} from 'react';
import {M3eCard} from '@m3e/react/card';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eDialog} from '@m3e/react/dialog';
import {ChevronLeft,ChevronRight,Expand,ImageOff,Play,X,EyeOff} from 'lucide-react';
import {mediaScrollTarget} from '../lib/media-scroll';
import {mediaAspectRatio,type NoteMedia} from '../lib/note-media';
import {compileMarkdown} from '../lib/compiled-markdown';
import MarkdownContent from './markdown-content';
import {InlineMediaContext} from './inline-media';
import QuoteCard from './quote-card';
import {quoteIds,quoteDisplayContent} from '../lib/quotes';
import './note-content.css';
import {useRowRetention} from './windowed-feed';

export function Media({item,onExpand}:{item:NoteMedia;onExpand:(src:NoteMedia)=>void}){
 const [failed,setFailed]=useState(false),[videoReady,setVideoReady]=useState(false);
 useRowRetention(videoReady||failed);
 return <M3eCard variant="filled" className="petal-media-card"><div className="petal-media-frame" style={{'--petal-media-ratio':mediaAspectRatio(item)} as CSSProperties}>{failed?<div className="petal-media-placeholder"><ImageOff aria-hidden="true"/><span>読み込めませんでした</span><M3eButton href={item.url} target="_blank" rel="noopener noreferrer">元のファイル</M3eButton></div>:item.type==='image'?<><img src={item.url} width={item.width} height={item.height} alt={item.alt||'投稿の画像'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/><M3eIconButton className="petal-media-expand" variant="tonal" aria-label="画像を拡大" onClick={()=>onExpand(item)}><Expand/></M3eIconButton></>:videoReady?<video src={item.url} width={item.width} height={item.height} controls playsInline preload="metadata" onError={()=>setFailed(true)} aria-label={item.alt||'投稿の動画'}/>:<div className="petal-media-placeholder"><M3eButton variant="tonal" onClick={()=>setVideoReady(true)}><Play slot="icon"/>動画を読み込む</M3eButton></div>}</div></M3eCard>;
}

function MediaGroup({items,onExpand}:{items:NoteMedia[];onExpand:(src:NoteMedia)=>void}){
 const scrollable=items.length>1;
 const strip=useRef<HTMLDivElement>(null),id=useId();
 const [navigation,setNavigation]=useState({previous:false,next:false});
 const updateNavigation=useCallback(()=>{
  const element=strip.current;if(!element)return;
  const previous=element.scrollLeft>1,next=element.scrollLeft<element.scrollWidth-element.clientWidth-1;
  setNavigation(old=>old.previous===previous&&old.next===next?old:{previous,next});
 },[]);
 useEffect(()=>{
  const element=strip.current;if(!scrollable||!element)return;
  const observer=new ResizeObserver(updateNavigation);observer.observe(element);
  return ()=>observer.disconnect();
 },[scrollable,items.length,updateNavigation]);
 function move(direction:-1|1){
  const element=strip.current;if(!element||!(direction===-1?navigation.previous:navigation.next))return;
  const left=element.getBoundingClientRect().left;
  const offsets=Array.from(element.children,child=>child.getBoundingClientRect().left-left+element.scrollLeft);
  element.scrollTo({left:mediaScrollTarget(element.scrollLeft,offsets,element.scrollWidth-element.clientWidth,direction),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }
 return <div className="petal-media-group" onClick={e=>e.stopPropagation()}>
  {scrollable&&<>
   <M3eIconButton className="petal-media-nav petal-media-previous" variant="tonal" aria-label="前の画像・動画" aria-controls={id} disabledInteractive={!navigation.previous} onClick={()=>move(-1)}><ChevronLeft aria-hidden="true"/></M3eIconButton>
   <M3eIconButton className="petal-media-nav petal-media-next" variant="tonal" aria-label="次の画像・動画" aria-controls={id} disabledInteractive={!navigation.next} onClick={()=>move(1)}><ChevronRight aria-hidden="true"/></M3eIconButton>
  </>}
  <div ref={strip} id={id} className={'petal-note-media'+(scrollable?' petal-media-strip':'')} onScroll={scrollable?updateNavigation:undefined}
  role={scrollable?'group':undefined} aria-label={scrollable?'投稿の画像・動画（横スクロール）':undefined} tabIndex={scrollable?0:undefined}
  onFocus={scrollable?e=>{
   // Native focus scrolling can leave a partially visible button clipped by snap.
   // Only adjust keyboard focus: moving a card during pointerdown cancels clicks.
   if(e.target!==e.currentTarget&&e.target.matches(':focus-visible'))e.target.closest('.petal-media-card')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }:undefined}>
  {items.map(item=><Media key={item.url} item={item} onExpand={onExpand}/>)}
 </div></div>;
}

function Content({content,tags,noteId,quoteDepth}:{content:string;tags:string[][];noteId:string;quoteDepth:number}){
 const quotes=useMemo(()=>quoteDepth===0?quoteIds(content,tags,noteId):[],[content,tags,noteId,quoteDepth]);
 const displayContent=useMemo(()=>quoteDisplayContent(content,quotes),[content,quotes]);
 const data=useMemo(()=>compileMarkdown(displayContent,tags),[displayContent,tags]);
 // NIP-36's content-warning tag applies even when its reason is empty,
 // and covers the entire event, not only URLs recognised as media.
 const warning=tags.find(tag=>tag[0]==='content-warning');
 const [revealed,setRevealed]=useState(false),[expanded,setExpanded]=useState<NoteMedia|null>(null),[open,setOpen]=useState(false);
 useRowRetention(revealed||expanded!==null||open);
 const visible=!data.sensitive||revealed;
 function conceal(){setOpen(false);setExpanded(null);setRevealed(false);}
 return <div className="petal-note-body">
  {warning&&<M3eCard variant="filled" className="petal-content-warning"><div className="petal-warning-inner"><div className="petal-warning-copy"><span>センシティブな内容</span>{!visible&&warning[1]?.trim()&&<span className="petal-warning-reason">{warning[1].slice(0,300)}</span>}</div><M3eButton variant="tonal" onClick={()=>visible?conceal():setRevealed(true)} aria-expanded={visible?'true':'false'}>{visible&&<EyeOff slot="icon"/>}{visible?'隠す':'表示する'}</M3eButton></div></M3eCard>}
  {visible&&<><InlineMediaContext.Provider value={items=><MediaGroup items={items} onExpand={m=>{setExpanded(m);setOpen(true)}}/>}><MarkdownContent content={displayContent} tags={tags}/></InlineMediaContext.Provider>
  {quotes.map(id=><QuoteCard key={id} id={id}/>)}
  {expanded&&<M3eDialog open={open} onClosed={()=>{setOpen(false);setExpanded(null)}} dismissible closeLabel="閉じる" aria-label="画像を拡大" className="petal-image-dialog"><X slot="close-icon"/><img src={expanded.url} alt={expanded.alt||'投稿の画像'} referrerPolicy="no-referrer"/></M3eDialog>}</>}
 </div>;
}
const NoteContent=memo(function NoteContent({content,tags=[],noteId='',quoteDepth=0}:{content:string;tags?:string[][];noteId?:string;quoteDepth?:number}){
 // Reset disclosure and media state synchronously when a reused post changes.
 return <Content key={JSON.stringify([content,tags])} content={content} tags={tags} noteId={noteId} quoteDepth={quoteDepth}/>;
});
export default NoteContent;
