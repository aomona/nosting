'use client';
import {useEffect,useLayoutEffect,useState,useRef,type ReactNode} from 'react';
import type {Event} from 'nostr-tools';
import {M3eButton} from '@m3e/react/button';
import {Heart,Repeat2,MessageCircle,AtSign,RefreshCw} from 'lucide-react';
import EmojiText from './custom-emoji';
import {emojiMap} from '../lib/custom-emoji';
import Loading from './loading';
import NoteTime from './note-time';
import {createNotificationHistory,emptyNotificationHistory,NOTIFICATION_LIMIT} from '../lib/notification-history';
import './notification-feed.css';
const initial={...emptyNotificationHistory,owner:''};
export default function NotificationFeed({pubkey,readRelays,renderNote,onLogin,onProfile,onOpen,onEvents,nameFor,isMuted}:{pubkey:string;readRelays:string[];renderNote:(event:Event)=>ReactNode;onLogin:()=>void;onProfile:(key:string)=>void;onOpen:(event:Event)=>void;onEvents?:(events:Event[])=>void;nameFor?:(key:string)=>string;isMuted?:(event:Event)=>boolean}){
 const [state,setState]=useState(initial),[attempt,setAttempt]=useState(0);
 const callback=useRef(onEvents),session=useRef<ReturnType<typeof createNotificationHistory>|null>(null);
 const feed=useRef<HTMLElement>(null),sentinel=useRef<HTMLDivElement>(null),anchor=useRef<{id:string;top:number}|null>(null);
 useEffect(()=>{callback.current=onEvents},[onEvents]);
 const key=JSON.stringify(readRelays),owner=pubkey+key;
 useEffect(()=>{
  if(!pubkey)return;
  let shownItems=initial.items;
  const controller=createNotificationHistory(pubkey,JSON.parse(key),next=>{
   if(next.items!==shownItems&&!anchor.current&&window.scrollY>0){
    const row=Array.from(feed.current?.querySelectorAll<HTMLElement>('[data-notification-id]')??[]).find(row=>row.getBoundingClientRect().bottom>0);
    if(row)anchor.current={id:row.dataset.notificationId!,top:row.getBoundingClientRect().top};
   }
   shownItems=next.items;setState({...next,owner});
  });
  session.current=controller;
  return()=>{controller.stop();session.current=null;anchor.current=null};
 },[pubkey,key,owner,attempt]);
 useLayoutEffect(()=>{
  const saved=anchor.current;anchor.current=null;if(!saved)return;
  const row=Array.from(feed.current?.querySelectorAll<HTMLElement>('[data-notification-id]')??[]).find(row=>row.dataset.notificationId===saved.id);
  if(row)window.scrollBy({top:row.getBoundingClientRect().top-saved.top,behavior:'instant'});
 },[state]);
 useEffect(()=>{
  if(!pubkey||state.owner!==owner||state.loading||state.done||state.limited||state.failed||!state.total||!sentinel.current||typeof IntersectionObserver==='undefined')return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))session.current?.loadOlder()},{rootMargin:'240px'});
  observer.observe(sentinel.current);return()=>observer.disconnect();
 },[pubkey,owner,state]);
 const items=state.owner===owner?state.items.filter(item=>!isMuted?.(item.event)&&(!item.target||!isMuted?.(item.target))):[];
 useEffect(()=>{if(state.owner===owner&&state.items.length)callback.current?.(state.items.filter(item=>!isMuted?.(item.event)&&(!item.target||!isMuted?.(item.target))).flatMap(i=>i.target?[i.event,i.target]:[i.event]))},[state.items,state.owner,owner,isMuted]);
 if(!pubkey)return <section className="notification-empty"><p>通知を見るにはログインしてください。</p><M3eButton variant="filled" onClick={onLogin}>ログイン</M3eButton></section>;
 return <section ref={feed} className="notification-feed" aria-label="通知"><div className="notification-toolbar"><M3eButton variant="text" disabled={state.loading||state.limited} onClick={()=>session.current?.refresh()}><RefreshCw slot="icon" aria-hidden="true"/>更新</M3eButton></div>{items.map(item=>{const Icon=item.type==='reaction'?Heart:item.type==='repost'?Repeat2:item.type==='reply'?MessageCircle:AtSign;return <article key={item.event.id} data-notification-id={item.event.id} className="notification-item"><div className="notification-summary"><Icon aria-hidden="true"/><button className="notification-person" onClick={()=>onProfile(item.event.pubkey)}>{nameFor?.(item.event.pubkey)||`${item.event.pubkey.slice(0,10)}…`}</button><span>{item.type==='reaction'?'リアクション':item.type==='repost'?'リポスト':item.type==='reply'?'返信':'メンション'}</span><NoteTime createdAt={item.event.created_at}/></div>{item.type==='reaction'&&<p className="notification-reaction"><EmojiText text={item.event.content==='+'?'♡':item.event.content.slice(0,100)||'♡'} emojis={item.event.tags.some(t=>t[0]==='content-warning')?{}:emojiMap(item.event.tags)}/></p>}{item.type==='reply'||item.type==='mention'?renderNote(item.event):item.target&&<button className="notification-target" onClick={()=>onOpen(item.target!)}>{item.target.tags.some(t=>t[0]==='content-warning')?'センシティブな投稿':item.target.content.slice(0,240)||'投稿を開く'}</button>}</article>})}<div ref={sentinel} className="notification-empty notification-history" aria-live="polite" aria-busy={state.loading}>
 {state.owner!==owner||state.loading?<Loading/>:!state.total?<p>メンション受信先を設定してください。</p>:state.limited?<><p>{NOTIFICATION_LIMIT}件を読み込みました</p><M3eButton variant="tonal" onClick={()=>{window.scrollTo({top:0,behavior:'instant'});setAttempt(v=>v+1)}}>最新から読み直す</M3eButton></>:<>
 {state.refreshFailed>0&&<div><p>新着を取得できないリレーがあります。</p><M3eButton variant="text" onClick={()=>session.current?.refresh()}>新着を再試行</M3eButton></div>}
 {state.failed>0?<><p>{state.boundary?'同じ時刻の通知を取得しきれませんでした。':'一部のリレーから取得できませんでした。'}</p><M3eButton variant="tonal" onClick={()=>session.current?.loadOlder(true)}>再試行</M3eButton>{state.hasMore&&<M3eButton variant="text" onClick={()=>session.current?.loadOlder()}>取得できたリレーで続ける</M3eButton>}</>:state.done?<p>{items.length?'これ以上の通知はありません':'このリレーでは通知が見つかりませんでした。'}</p>:<M3eButton variant="text" onClick={()=>session.current?.loadOlder()}>過去の通知を読み込む</M3eButton>}
 </>}
 </div></section>
}
