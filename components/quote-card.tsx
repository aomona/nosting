'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {M3eCard} from '@m3e/react/card';
import {M3eButton} from '@m3e/react/button';
import {Quote} from 'lucide-react';
import type {Event as NostrEvent} from 'nostr-tools';
import type {QuoteResult} from '../lib/quotes';
import {MuteContext} from './mute-context';
import {useEventDeleted} from './event-deletion';
import NoteContent from './note-content';
import './quote-card.css';
export const QuoteContext=createContext<((id:string)=>Promise<QuoteResult>)|null>(null);
export const QuoteOpenContext=createContext<((event:NostrEvent)=>void)|null>(null);
export default function QuoteCard({id}:{id:string}){
 const isMuted=useContext(MuteContext);
 const open=useContext(QuoteOpenContext),resolve=useContext(QuoteContext),node=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[result,setResult]=useState<QuoteResult|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!node.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return}const observer=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'});observer.observe(node.current);return()=>observer.disconnect()},[]);
 useEffect(()=>{if(!visible||!resolve)return;let current=true;setResult(null);void resolve(id).then(r=>{if(current)setResult(r)},()=>{if(current)setResult({error:'引用を取得できませんでした'})});return()=>{current=false}},[visible,id,resolve,retry]);
 const deleted=useEventDeleted(result?.event);
 if(deleted)return <div className="petal-quote-status" role="status">削除要求済みの引用</div>;
 if(result?.event&&isMuted(result.event))return <div className="petal-quote-status">ミュートした引用を非表示にしています。</div>;
 return <div ref={node} className="petal-quote" tabIndex={result?.event&&open?0:undefined} role={result?.event&&open?'link':undefined} aria-label={result?.event&&open?'引用投稿を開く':undefined} onKeyDown={e=>{if(e.target===e.currentTarget&&result?.event&&open&&(e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();e.stopPropagation();open(result.event)}}} onClick={e=>{e.stopPropagation();if(window.getSelection()?.toString()||(e.target as Element).closest('a,button,input,textarea,video,audio,img,m3e-button,m3e-icon-button'))return;if(result?.event)open?.(result.event)}}><M3eCard variant="outlined" className="petal-quote-card"><div className="petal-quote-inner"><div className="petal-quote-heading"><Quote size={18} aria-hidden="true"/><span>{result?.event?result.event.pubkey.slice(0,8)+'…'+result.event.pubkey.slice(-4):'引用'}</span></div>{result?.event?<NoteContent content={result.event.content} tags={result.event.tags} noteId={result.event.id} quoteDepth={1}/>:result?.error?<div className="petal-quote-status"><span>{result.error}</span><M3eButton variant="text" onClick={()=>setRetry(n=>n+1)}>再試行</M3eButton></div>:visible?<span className="petal-quote-status" role="status">読み込み中…</span>:null}</div></M3eCard></div>;
}
