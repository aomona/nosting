'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {M3eIconButton,type M3eIconButtonElement} from '@m3e/react/icon-button';
import {M3eMenu,M3eMenuItem,type M3eMenuElement} from '@m3e/react/menu';
import {Pencil,Repeat2} from 'lucide-react';

type Action=(signal:AbortSignal,close:()=>void)=>Promise<boolean>;

/** M3E owns the top-layer surface, positioning, focus navigation and motion. */
export default function RepostMenu({onRepost,onQuote}:{onRepost:Action;onQuote:Action}){
 const id=useId(),menu=useRef<M3eMenuElement>(null),trigger=useRef<M3eIconButtonElement>(null);
 const opening=useRef(false),operation=useRef<AbortController|null>(null);
 const [open,setOpen]=useState(false),[pending,setPending]=useState(false);
 useEffect(()=>()=>operation.current?.abort(),[]);
 useEffect(()=>{
  if(!open)return;
  // M3E observes overflow containers; the document's default visible overflow
  // also scrolls on this timeline. Dismiss without scrolling the trigger back.
  const initialX=window.scrollX,initialY=window.scrollY;
  const onScroll=(event:Event)=>{
   if(event.target instanceof Node&&menu.current?.contains(event.target))return;
   // Focus/scrollIntoView can queue a scroll event before the menu opens.
   if(event.target===document&&window.scrollX===initialX&&window.scrollY===initialY)return;
   menu.current?.hide();
  };
  window.addEventListener('scroll',onScroll,true);
  return()=>window.removeEventListener('scroll',onScroll,true);
 },[open]);

 async function toggle(){
  if(opening.current||!menu.current||!trigger.current)return;
  opening.current=true;
  try{await menu.current.toggle(trigger.current)}finally{opening.current=false}
 }
 async function select(action:Action){
  if(operation.current)return;
  const controller=new AbortController();operation.current=controller;setPending(true);
  try{if(await action(controller.signal,()=>menu.current?.hide(true))&&!controller.signal.aborted)menu.current?.hide(true)}
  finally{if(operation.current===controller){operation.current=null;setPending(false)}}
 }

 return <>
  <M3eIconButton ref={trigger} title="リポスト" aria-label="リポスト" aria-haspopup="menu" aria-controls={id} aria-expanded={open?'true':'false'} onClick={event=>{event.stopPropagation();void toggle()}} onKeyDown={event=>{
   if(event.repeat){event.preventDefault();return}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();void toggle()}
  }}><Repeat2 size={19} aria-hidden="true"/></M3eIconButton>
  <M3eMenu ref={menu} id={id} aria-label="リポストの操作" onBeforeToggle={event=>{
   const opening=(event as ToggleEvent).newState==='open';setOpen(opening);
   if(!opening){operation.current?.abort();operation.current=null;setPending(false)}
  }} onClickCapture={event=>{
   // Keep the two choices visible while login/signing is pending. Prevent the
   // item's automatic close, and never let its click open the containing note.
   event.preventDefault();event.stopPropagation();
   const item=(event.target as Element).closest('m3e-menu-item');
   if(!item||pending)return;
   void select(item.getAttribute('data-action')==='quote'?onQuote:onRepost);
  }} onKeyDown={event=>event.stopPropagation()}>
   {/* Keep items focusable during async work so Escape and arrow keys still work. */}
   <M3eMenuItem data-action="repost" aria-disabled={pending?'true':'false'}><Repeat2 slot="icon" aria-hidden="true"/>リポスト</M3eMenuItem>
   <M3eMenuItem data-action="quote" aria-disabled={pending?'true':'false'}><Pencil slot="icon" aria-hidden="true"/>引用する</M3eMenuItem>
  </M3eMenu>
 </>;
}
