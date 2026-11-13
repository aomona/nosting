'use client';
import {useEffect,useState,useRef,type ReactNode} from 'react';
import type {Event} from 'nostr-tools';
import {M3eButton} from '@m3e/react/button';
import {Heart,Repeat2,MessageCircle,AtSign,RefreshCw} from 'lucide-react';
import EmojiText from './custom-emoji';
import {emojiMap} from '../lib/custom-emoji';
import Loading from './loading';
import NoteTime from './note-time';
import {autoRefreshNotifications,type NotificationSnapshot} from '../lib/notifications';
import './notification-feed.css';
const initial:NotificationSnapshot & {owner?:string}={items:[],loading:true,complete:0,failed:0,total:0,truncated:false};
export default function NotificationFeed({pubkey,readRelays,renderNote,onLogin,onProfile,onOpen,onEvents,nameFor,isMuted}:{pubkey:string;readRelays:string[];renderNote:(event:Event)=>ReactNode;onLogin:()=>void;onProfile:(key:string)=>void;onOpen:(event:Event)=>void;onEvents?:(events:Event[])=>void;nameFor?:(key:string)=>string;isMuted?:(event:Event)=>boolean}){
 const [state,setState]=useState(initial),[attempt,setAttempt]=useState(0);const callback=useRef(onEvents);useEffect(()=>{callback.current=onEvents},[onEvents]);const key=JSON.stringify(readRelays);
 useEffect(()=>{if(!pubkey)return;let active=true;const stop=autoRefreshNotifications(pubkey,JSON.parse(key),next=>{if(active)setState({...next,owner:pubkey} as typeof initial)});return()=>{active=false;stop()}},[pubkey,key,attempt]);
 const items=state.owner===pubkey?state.items.filter(item=>!isMuted?.(item.event)&&(!item.target||!isMuted?.(item.target))):[];
 useEffect(()=>{if(state.owner===pubkey&&state.items.length)callback.current?.(state.items.filter(item=>!isMuted?.(item.event)&&(!item.target||!isMuted?.(item.target))).flatMap(i=>i.target?[i.event,i.target]:[i.event]))},[state.items,state.owner,pubkey,isMuted]);
 if(!pubkey)return <section className="notification-empty"><p>通知を見るにはログインしてください。</p><M3eButton variant="filled" onClick={onLogin}>ログイン</M3eButton></section>;
 return <section className="notification-feed" aria-label="通知"><div className="notification-toolbar"><M3eButton variant="text" onClick={()=>setAttempt(v=>v+1)}><RefreshCw slot="icon" aria-hidden="true"/>更新</M3eButton></div>{items.map(item=>{const Icon=item.type==='reaction'?Heart:item.type==='repost'?Repeat2:item.type==='reply'?MessageCircle:AtSign;return <article key={item.event.id} className="notification-item"><div className="notification-summary"><Icon aria-hidden="true"/><button className="notification-person" onClick={()=>onProfile(item.event.pubkey)}>{nameFor?.(item.event.pubkey)||`${item.event.pubkey.slice(0,10)}…`}</button><span>{item.type==='reaction'?'リアクション':item.type==='repost'?'リポスト':item.type==='reply'?'返信':'メンション'}</span><NoteTime createdAt={item.event.created_at}/></div>{item.type==='reaction'&&<p className="notification-reaction"><EmojiText text={item.event.content==='+'?'♡':item.event.content.slice(0,100)||'♡'} emojis={item.event.tags.some(t=>t[0]==='content-warning')?{}:emojiMap(item.event.tags)}/></p>}{item.type==='reply'||item.type==='mention'?renderNote(item.event):item.target&&<button className="notification-target" onClick={()=>onOpen(item.target!)}>{item.target.tags.some(t=>t[0]==='content-warning')?'センシティブな投稿':item.target.content.slice(0,240)||'投稿を開く'}</button>}</article>})}{state.loading?<Loading/>:<div className="notification-empty" role="status">{!state.total?<p>メンション受信先を設定してください。</p>:!state.complete?<p>通知を取得できませんでした。</p>:<>{!items.length&&<p>このリレーでは通知が見つかりませんでした。</p>}{state.failed>0&&<p>一部のリレーから取得できませんでした。</p>}{state.truncated&&<p>最近の通知を表示しています。</p>}</>}</div>}</section>
}
