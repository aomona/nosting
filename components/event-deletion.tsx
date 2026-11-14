'use client';
import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import type {Event,EventTemplate} from 'nostr-tools';
import {M3eDialog} from '@m3e/react/dialog';
import {M3eButton} from '@m3e/react/button';
import {MoreHorizontal,Trash2,X} from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './ui/dropdown-menu';
import './profile-menu.css';
import './note-event-menu.css';
import {DeletionTracker,sendDeletion,type DeletionTarget} from '../lib/deletions';

type ContextValue={tracker:DeletionTracker;owner:string;request:(target:DeletionTarget,trigger:HTMLElement|null)=>void};
const Context=createContext<ContextValue|null>(null);
const noopSubscribe=()=>()=>{};
export function useEventDeleted(event?:DeletionTarget){
 const context=useContext(Context),tracker=context?.tracker;
 useEffect(()=>event?tracker?.watch(event):undefined,[tracker,event]);
 const snapshot=()=>!!event&&!!tracker?.isDeleted(event);
 return useSyncExternalStore(tracker?.subscribe??noopSubscribe,snapshot,()=>false);
}
/** A single header menu also covers an owned repost of somebody else's note. */
export function NoteEventMenu({event,repost}:{event?:DeletionTarget;repost?:DeletionTarget}){
 const context=useContext(Context),trigger=useRef<HTMLButtonElement>(null),openingDialog=useRef(false);
 const targets=[event?.kind===1?event:undefined,repost?.kind===6?repost:undefined].filter((value):value is DeletionTarget=>!!value&&!!context?.owner&&value.pubkey===context.owner);
 if(!context||!targets.length)return null;
 return <DropdownMenu modal={false}><DropdownMenuTrigger ref={trigger} className="note-menu-trigger" aria-label="投稿の操作"><MoreHorizontal size={18} aria-hidden="true"/></DropdownMenuTrigger><DropdownMenuContent className="profile-action-menu" portalContainer={typeof document!=='undefined'?document.querySelector('m3e-theme'):null} align="end" sideOffset={8} onClick={event=>event.stopPropagation()} onCloseAutoFocus={event=>{if(openingDialog.current){event.preventDefault();openingDialog.current=false}}}>{targets.map(target=><DropdownMenuItem key={target.id} onSelect={()=>{openingDialog.current=true;context.request(target,trigger.current)}}><Trash2 aria-hidden="true"/>{target.kind===6?'リポストの削除を要求':'投稿の削除を要求'}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}
export default function EventDeletionProvider({tracker,owner,currentOwner,publish,children}:{
 tracker:DeletionTracker;owner:string;currentOwner:()=>string;
 publish:(event:Event)=>Promise<{confirmed:number;total:number}>;children:ReactNode;
}){
 const [target,setTarget]=useState<DeletionTarget|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const pending=useRef<AbortController|null>(null),returnFocus=useRef<{trigger:HTMLElement|null;rowId?:string}|null>(null);
 const cancel=useCallback(()=>{pending.current?.abort();pending.current=null;setTarget(null);setBusy(false);setStatus('')},[]);
 const [dialogOwner,setDialogOwner]=useState(owner);
 if(dialogOwner!==owner){setDialogOwner(owner);setTarget(null);setBusy(false);setStatus('')}
 useLayoutEffect(()=>()=>{pending.current?.abort();pending.current=null},[owner]);
 const request=useCallback((event:DeletionTarget,trigger:HTMLElement|null)=>{cancel();returnFocus.current={trigger,rowId:trigger?.closest<HTMLElement>('article[data-note-id]')?.dataset.noteId};setTarget(event)},[cancel]);
 function closed(){
  cancel();const origin=returnFocus.current;returnFocus.current=null;if(!origin)return;
  const row=origin.rowId?document.querySelector<HTMLElement>(`article[data-note-id="${CSS.escape(origin.rowId)}"]`):null;
  // The trigger disappears after a successful deletion; its tombstone is the fallback.
  (origin.trigger?.isConnected?origin.trigger:row??document.getElementById('main-content'))?.focus({preventScroll:true});
 }
 const context=useMemo(()=>({tracker,owner,request}),[tracker,owner,request]);
 async function confirm(){
  if(!target||pending.current)return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setStatus('');
  try{
   const result=await sendDeletion({target,owner,currentOwner,signal:controller.signal,
    sign:event=>{const extension=(window as Window&{nostr?:{signEvent:(event:EventTemplate)=>Promise<Event>}}).nostr;if(!extension)throw Error('署名拡張機能に接続してください');return extension.signEvent(event)},publish});
   if(controller.signal.aborted||currentOwner()!==owner)return;
   if(result.confirmed){tracker.accept(result.event);setTarget(null);setStatus(`${result.confirmed}/${result.total}リレーで削除要求を確認しました`)}
   else setStatus('受信確認が取れません。削除要求が届いている可能性があります');
  }catch(error){if(!controller.signal.aborted&&currentOwner()===owner)setStatus(error instanceof Error?error.message:'削除要求を送信できませんでした')}
  finally{if(pending.current===controller){pending.current=null;setBusy(false)}}
 }
 return <Context.Provider value={context}>{children}<M3eDialog open={!!target||!!status} dismissible closeLabel="閉じる" onClosing={cancel} onClosed={closed} aria-label="削除要求"><X slot="close-icon"/><h2 slot="header">削除要求</h2>{target&&<><p>リレーや他の端末に残る場合があります。</p><M3eButton variant="filled" disabled={busy} onClick={()=>void confirm()}>{busy?'送信中…':'署名して削除を要求'}</M3eButton><M3eButton variant="text" onClick={cancel}>キャンセル</M3eButton></>}{status&&<p role="status">{status}</p>}</M3eDialog></Context.Provider>;
}
