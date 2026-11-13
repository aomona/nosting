'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Event} from 'nostr-tools';
import {M3eButton} from '@m3e/react/button';
import {UserPlus,UserCheck,RefreshCw} from 'lucide-react';
import {followDisplay} from '../lib/follow-list';
export default function FollowButton({owner,target,known,load,save,onLogin,onMessage}:{owner:string;target:string;known?:Event|null;load:(signal:AbortSignal)=>Promise<Event|null>;save:(base:Event|null,target:string,follow:boolean,signal:AbortSignal)=>Promise<{event:Event|null;unchanged:boolean;confirmed:number;total:number}>;onLogin:()=>void;onMessage:(text:string)=>void}){
 const [loaded,setLoaded]=useState<{owner:string;event:Event|null|undefined}>({owner,event:undefined}),[busy,setBusy]=useState(false),[error,setError]=useState('');const locked=useRef(false),request=useRef<AbortController|null>(null),loader=useRef(load);loader.current=load;
 const display=useMemo(()=>followDisplay(owner,target,loaded.owner===owner?loaded.event:undefined,known),[owner,target,loaded,known]);
 async function reload(){if(locked.current||!owner)return;locked.current=true;setBusy(true);setError('');const c=new AbortController();request.current=c;try{const event=await loader.current(c.signal);if(!c.signal.aborted)setLoaded({owner,event})}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'フォロー状態を確認できません')}finally{if(!c.signal.aborted){locked.current=false;setBusy(false)}}}
 useEffect(()=>{setLoaded({owner,event:undefined});setError('');setBusy(false);void reload();return()=>{request.current?.abort();locked.current=false}},[owner,target]);
 async function toggle(){if(!owner){onLogin();return}if(!display.known){await reload();return}if(locked.current)return;locked.current=true;setBusy(true);setError('');const c=new AbortController();request.current=c;try{const result=await save(display.event,target,!display.following,c.signal);if(!c.signal.aborted){if(!result.unchanged&&!result.confirmed)throw Error('受信確認が取れません。最新の状態を確認してから再試行してください');setLoaded({owner,event:result.event});if(!result.unchanged)onMessage(result.confirmed<result.total?`${result.confirmed}/${result.total} リレーで確認。残りは未確認です`:display.following?'フォローを解除しました':'フォローしました')}}catch(e){if(!c.signal.aborted){const message=e instanceof Error?e.message:'フォローを更新できませんでした';setError(message);onMessage(message)}}finally{if(!c.signal.aborted){locked.current=false;setBusy(false)}}}
 const label=!owner?'フォロー':display.known?(display.following?'フォロー中':'フォロー'):busy?'確認中…':'状態を確認';
 const action=!owner?'ログインしてフォローする':display.known?(display.following?'フォローを解除':'フォローする'):'フォロー状態を確認';
 if(owner===target)return null;
 return <M3eButton variant={display.following?'tonal':'filled'} disabled={busy} aria-busy={busy?'true':'false'} aria-label={action} title={error?`${action}（${error}）`:action} onClick={()=>void toggle()}>{!display.known&&owner?<RefreshCw slot="icon" aria-hidden="true"/>:display.following?<UserCheck slot="icon" aria-hidden="true"/>:<UserPlus slot="icon" aria-hidden="true"/>}{label}</M3eButton>
}
