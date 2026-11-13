'use client';
import {useEffect,useState,useRef,type ReactNode} from 'react';
import type {Event} from 'nostr-tools';
import {M3eButton} from '@m3e/react/button';
import {RefreshCw} from 'lucide-react';
import Loading from './loading';
import {watchReplies,type ReplySnapshot} from '../lib/thread-replies';
import './thread-detail.css';
const initial:ReplySnapshot={events:[],complete:0,failed:0,total:0,truncated:false,loading:true};
export default function ThreadDetail({event,readRelays,renderNote,onBack,onEvents}:{event:Event;readRelays:string[];renderNote:(event:Event)=>ReactNode;onBack:()=>void;onEvents?:(events:Event[])=>void}){
 const [state,setState]=useState<ReplySnapshot>(initial),[attempt,setAttempt]=useState(0);
 const eventsCallback=useRef(onEvents);eventsCallback.current=onEvents;
 const key=JSON.stringify(readRelays),scope=event.id+key;
 const retained=useRef<{scope:string;events:Map<string,Event>}>({scope,events:new Map()});
 useEffect(()=>{
  // A retry is additive; scope changes must never leak another thread's replies.
  if(retained.current.scope!==scope)retained.current={scope,events:new Map()};
  const cache=retained.current.events;
  return watchReplies(event.id,JSON.parse(key),snapshot=>{
   for(const reply of snapshot.events)if(cache.size<500||cache.has(reply.id))cache.set(reply.id,reply);
   setState({...snapshot,events:[...cache.values()].sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id))});
  });
 },[event.id,key,scope,attempt]);
 useEffect(()=>{if(state.events.length)eventsCallback.current?.(state.events)},[state.events]);
 const message=!state.total?'読み取りリレーを設定してください':state.failed?(state.events.length?'取得済みの返信を表示しています':state.complete?'一部のリレーに接続できませんでした':'返信を取得できませんでした'):!state.events.length?'返信は見つかりませんでした':state.truncated?'返信の一部を表示しています':'';
 return <section className="thread-detail" aria-label="投稿の詳細">{renderNote(event)}<h2 className="thread-replies-title">返信</h2><div>{state.events.map(e=><div key={e.id}>{renderNote(e)}</div>)}</div>{state.loading?<Loading/>:<div className="thread-replies-status" role="status">{message&&<span>{message}</span>}{state.total>0&&<M3eButton variant="text" onClick={()=>setAttempt(v=>v+1)} aria-label={state.failed?'返信の取得を再試行':'返信を更新'}><RefreshCw slot="icon" aria-hidden="true"/>{state.failed?'再試行':'更新'}</M3eButton>}</div>}</section>
}
