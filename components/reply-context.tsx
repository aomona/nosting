'use client';
import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type RefObject} from 'react';
import type {Event} from 'nostr-tools';
import {CornerUpLeft,ChevronRight} from 'lucide-react';
import {replyTarget,replyExcerpt,type ReplyTarget} from '../lib/reply-context';
import type {QuoteResult} from '../lib/quotes';
import {emojiMap} from '../lib/custom-emoji';
import {QuoteContext,QuoteOpenContext} from './quote-card';
import {MentionContext} from './mention';
import {MuteContext} from './mute-context';
import {useEventDeleted} from './event-deletion';
import ProfileAvatar from './profile-avatar';
import EmojiText from './custom-emoji';
import './reply-context.css';

type State={target:ReplyTarget;result:QuoteResult|null;anchor:RefObject<HTMLDivElement|null>;retry:()=>void};
const Context=createContext<State|null>(null);
const short=(key:string)=>key.slice(0,8)+'…'+key.slice(-4);
export function ReplyContext({event,children}:{event:Pick<Event,'id'|'kind'|'tags'>;children:ReactNode}){
 const target=useMemo(()=>replyTarget(event),[event.id,event.kind,event.tags]);
 const resolve=useContext(QuoteContext),people=useContext(MentionContext);
 const requestProfile=useRef(people?.request);requestProfile.current=people?.request;
 const anchor=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[attempt,setAttempt]=useState(0);
 const [settled,setSettled]=useState<{id:string;resolver:typeof resolve;result:QuoteResult}|null>(null);
 const id=target?.id;
 const result=settled&&settled.id===id&&settled.resolver===resolve?settled.result:null;
 useEffect(()=>{if(!id||!anchor.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'});observer.observe(anchor.current);return()=>observer.disconnect()},[id]);
 useEffect(()=>{if(!id||!visible)return;let current=true;setSettled(null);
  if(!resolve){setSettled({id,resolver:resolve,result:{error:'返信先を取得できませんでした'}});return}
  void resolve(id).then(value=>{if(!current)return;setSettled({id,resolver:resolve,result:value});if(value.event)requestProfile.current?.(value.event.pubkey)},()=>{if(current)setSettled({id,resolver:resolve,result:{error:'返信先を取得できませんでした'}})});
  return()=>{current=false};
 },[id,visible,resolve,attempt]);
 return <Context.Provider value={target?{target,result,anchor,retry:()=>setAttempt(value=>value+1)}:null}>{children}</Context.Provider>;
}
export function ReplyPreview(){
 const context=useContext(Context),people=useContext(MentionContext),open=useContext(QuoteOpenContext),isMuted=useContext(MuteContext);
 const deleted=useEventDeleted(context?.result?.event);
 if(!context)return null;
 const {target,result,anchor,retry}=context,event=result?.event,muted=!!event&&isMuted(event);
 const profile=event?people?.profiles[event.pubkey]:undefined,name=profile?.display_name||profile?.name||(event?short(event.pubkey):'');
 const excerpt=event?replyExcerpt(event):'';
 return <div ref={anchor} className="reply-context" data-reply-parent={target.id||'unknown'} onClick={e=>e.stopPropagation()}>
  <span className="reply-context-label" role="img" aria-label="返信"><CornerUpLeft size={16} aria-hidden="true"/></span>
  {event&&!muted&&!deleted?<button type="button" className="reply-parent-preview" aria-label={`${name}の投稿を開く（返信先）：${excerpt}`} onClick={()=>open?.(event)}>
   <ProfileAvatar picture={profile?.picture} name={name}/><span className="reply-parent-excerpt"><EmojiText text={excerpt} emojis={event.tags.some(tag=>tag[0]==='content-warning')?{}:emojiMap(event.tags)}/></span><ChevronRight size={15} aria-hidden="true"/>
  </button>:<span className="reply-parent-status" role="status">{deleted?'削除要求済みの返信先':muted?'ミュートした返信先を非表示にしています':!target.id?'返信先を特定できません':result?.error?'返信先を取得できませんでした':'返信先を読み込み中…'}</span>}
  {target.id&&result?.error&&<button type="button" className="reply-parent-retry" onClick={retry}>再試行</button>}
 </div>;
}
export function ReplyRecipient(){
 const context=useContext(Context),people=useContext(MentionContext),isMuted=useContext(MuteContext);
 if(!context)return null;
 const {target,result}=context,event=result?.event;
 if(event&&isMuted(event))return <div className="reply-recipient">返信先：ミュート中</div>;
 const profile=event?people?.profiles[event.pubkey]:undefined,name=profile?.display_name||profile?.name||(event?short(event.pubkey):'');
 return <div className="reply-recipient"><span>返信先：</span>{event?<button type="button" onClick={e=>{e.stopPropagation();people?.openProfile(event.pubkey)}} aria-label={`${name}のプロフィール`}>@<EmojiText text={name} emojis={profile?.emojis}/></button>:target.id?<a href={'#/thread/'+target.id} onClick={e=>{e.stopPropagation();/* The normal internal link opens the exact event without guessing its author. */}} aria-label={`返信先の投稿 ${short(target.id)}を開く`}>投稿 {short(target.id)}</a>:<span>不明</span>}</div>;
}
