'use client';
import {memo,useMemo,useState,type CSSProperties} from 'react';
import {M3eCard} from '@m3e/react/card';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eDialog} from '@m3e/react/dialog';
import {Expand,ImageOff,Play,X,EyeOff} from 'lucide-react';
import {mediaAspectRatio,type NoteMedia} from '../lib/note-media';
import {compileMarkdown} from '../lib/compiled-markdown';
import MarkdownContent from './markdown-content';
import QuoteCard from './quote-card';
import {quoteIds,quoteDisplayContent} from '../lib/quotes';
import './note-content.css';
import {useRowRetention} from './windowed-feed';

export function Media({item,onExpand}:{item:NoteMedia;onExpand:(src:NoteMedia)=>void}){
 const [failed,setFailed]=useState(false),[videoReady,setVideoReady]=useState(false);
 useRowRetention(videoReady||failed);
 return <M3eCard variant="filled" className="petal-media-card"><div className="petal-media-frame" style={{'--petal-media-ratio':mediaAspectRatio(item)} as CSSProperties}>{failed?<div className="petal-media-placeholder"><ImageOff aria-hidden="true"/><span>読み込めませんでした</span><M3eButton href={item.url} target="_blank" rel="noopener noreferrer">元のファイル</M3eButton></div>:item.type==='image'?<><img src={item.url} width={item.width} height={item.height} alt={item.alt||'投稿の画像'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/><M3eIconButton className="petal-media-expand" variant="tonal" aria-label="画像を拡大" onClick={()=>onExpand(item)}><Expand/></M3eIconButton></>:videoReady?<video src={item.url} width={item.width} height={item.height} controls playsInline preload="metadata" onError={()=>setFailed(true)} aria-label={item.alt||'投稿の動画'}/>:<div className="petal-media-placeholder"><M3eButton variant="tonal" onClick={()=>setVideoReady(true)}><Play slot="icon"/>動画を読み込む</M3eButton></div>}</div></M3eCard>;
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
  {visible&&<><MarkdownContent content={displayContent} tags={tags}/>{data.items.length>0&&<div className={'petal-note-media'+(data.items.length>1?' petal-media-grid':'')}>{data.items.map(item=><Media key={item.url} item={item} onExpand={m=>{setExpanded(m);setOpen(true)}}/>)}</div>}
  {quotes.map(id=><QuoteCard key={id} id={id}/>)}
  {expanded&&<M3eDialog open={open} onClosed={()=>{setOpen(false);setExpanded(null)}} dismissible closeLabel="閉じる" aria-label="画像を拡大" className="petal-image-dialog"><X slot="close-icon"/><img src={expanded.url} alt={expanded.alt||'投稿の画像'} referrerPolicy="no-referrer"/></M3eDialog>}</>}
 </div>;
}
const NoteContent=memo(function NoteContent({content,tags=[],noteId='',quoteDepth=0}:{content:string;tags?:string[][];noteId?:string;quoteDepth?:number}){
 // Reset disclosure and media state synchronously when a reused post changes.
 return <Content key={JSON.stringify([content,tags])} content={content} tags={tags} noteId={noteId} quoteDepth={quoteDepth}/>;
});
export default NoteContent;
