'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import type {Event,EventTemplate} from 'nostr-tools';
import {Heart,SmilePlus,X} from 'lucide-react';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eButton} from '@m3e/react/button';
import {M3eDialog} from '@m3e/react/dialog';
import {M3eFormField} from '@m3e/react/form-field';
import {ReactionSession} from '../lib/reaction-session';
import {reactionKey,type ReactionChoice,type ReactionReceipt,type ReactionTarget} from '../lib/reactions';
import {emojiMap} from '../lib/custom-emoji';
import EmojiText from './custom-emoji';
import './reactions.css';

type Actions={currentOwner:()=>string;sign:(e:EventTemplate)=>Promise<Event>;publish:(e:Event)=>Promise<ReactionReceipt>;login:()=>void;notify:(message:string)=>void};
const Context=createContext<{session:ReactionSession;actions:Actions;scope:string}|null>(null);
export function ReactionsProvider({owner,relays,actions,children}:{owner:string;relays:string[];actions:Actions;children:ReactNode}) {
  const session=useMemo(()=>new ReactionSession(owner,relays),[owner,relays]);
  useEffect(()=>{session.start();return()=>session.stop()},[session]);
  return <Context.Provider value={{session,actions,scope:owner+relays.join(',')}}>{children}</Context.Provider>;
}
const serverSnapshot={events:[] as Event[],loading:false,partial:false,available:false};
export default function ReactionButtons({target}:{target:ReactionTarget}) {
  const context=useContext(Context);
  // NoteList also has standalone previews; no provider means no network or signing.
  if(!context)return <M3eIconButton aria-label="いいね" disabled><Heart size={18}/></M3eIconButton>;
  return <AccountReactionButtons key={context.scope} target={target} session={context.session} actions={context.actions}/>;
}
function AccountReactionButtons({target,session,actions}:{target:ReactionTarget;session:ReactionSession;actions:Actions}) {
  const subscribe=useCallback((listener:()=>void)=>session.watch(target,listener),[session,target]);
  const snapshot=useSyncExternalStore(subscribe,()=>session.snapshot(target.id),()=>serverSnapshot);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [unicode,setUnicode]=useState(''),[code,setCode]=useState(''),[url,setUrl]=useState('');
  const operation=useRef<AbortController|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[session]);
  const likes=snapshot.events.filter(e=>reactionKey(e)==='+');
  const groups=[...new Map(snapshot.events.map(e=>[reactionKey(e),e])).values()];
  const close=()=>{operation.current?.abort();setOpen(false)};
  async function change(choice?:ReactionChoice,remove?:Event[]) {
    if(!session.owner){actions.login();return}
    if(busy||operation.current)return;
    if(snapshot.loading||!snapshot.available){setError('リアクションを確認できません。再試行してください');setOpen(true);return}
    const controller=new AbortController();operation.current=controller;
    const cancel=()=>controller.abort();session.abort.signal.addEventListener('abort',cancel,{once:true});
    setBusy(true);setError('');
    try {
      const result=await session.writer.send({target,choice,remove,signal:controller.signal,currentOwner:actions.currentOwner,sign:actions.sign,publish:actions.publish});
      session.emit();
      if(result.unchanged)return;
      if(!result.confirmed)throw Error('受信確認が取れません。同じ操作で再送できます');
      actions.notify(result.confirmed<result.total?`${result.confirmed}/${result.total}リレーで確認。残りは未確認です`:remove?'リアクションを取り消しました':'リアクションしました');
    }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'送信できませんでした');setOpen(true)}}
    finally{session.abort.signal.removeEventListener('abort',cancel);operation.current=null;if(!session.abort.signal.aborted)setBusy(false)}
  }
  return <>
    <M3eIconButton title={likes.length?'いいねを取り消す':'いいね'} aria-label={likes.length?'いいねを取り消す':'いいね'} aria-pressed={likes.length?'true':'false'} className={likes.length?'liked':''} disabled={busy||snapshot.loading} onClick={()=>void change({content:'+'},likes.length?likes:undefined)}><Heart size={18} fill={likes.length?'currentColor':'none'}/></M3eIconButton>
    <M3eIconButton width="narrow" title="リアクション" aria-label="リアクション" aria-pressed={snapshot.events.some(e=>reactionKey(e)!=='+')?'true':'false'} onClick={()=>{if(!session.owner)actions.login();else setOpen(true)}}><SmilePlus size={18}/></M3eIconButton>
    {open&&<M3eDialog open dismissible closeLabel="閉じる" onClosing={()=>operation.current?.abort()} onCancel={()=>operation.current?.abort()} onClick={e=>e.stopPropagation()} onClosed={close} aria-label="リアクション"><X slot="close-icon"/><h2 slot="header">リアクション</h2><div className="reaction-panel" onClick={e=>e.stopPropagation()}>
      {groups.length>0&&<div className="reaction-own" aria-label="自分のリアクション">{groups.map(event=><M3eButton key={reactionKey(event)} variant="tonal" disabled={busy||snapshot.loading} aria-label={`${event.content||'+'} を取り消す`} onClick={()=>void change(undefined,snapshot.events.filter(e=>reactionKey(e)===reactionKey(event)))}>{reactionKey(event)==='+'?'いいね':reactionKey(event)==='-'?'低評価':<EmojiText text={event.content} emojis={emojiMap(event.tags)}/>}<X size={14}/></M3eButton>)}</div>}
      <div className="reaction-options">{['👍','❤️','😂','🎉','🤔','👀'].map(content=><M3eButton key={content} variant="tonal" disabled={busy||snapshot.loading} aria-label={`${content} を送信`} onClick={()=>void change({content})}>{content}</M3eButton>)}</div>
      <form onSubmit={e=>{e.preventDefault();void change({content:unicode})}}><M3eFormField variant="outlined"><label slot="label" htmlFor={`reaction-unicode-${target.id}`}>絵文字</label><input id={`reaction-unicode-${target.id}`} value={unicode} maxLength={64} onChange={e=>setUnicode(e.target.value)}/></M3eFormField><M3eButton type="submit" disabled={busy||snapshot.loading||!unicode}>送信</M3eButton></form>
      <details><summary>カスタム絵文字</summary><form onSubmit={e=>{e.preventDefault();void change({content:`:${code}:`,emoji:{code,url}})}}><M3eFormField variant="outlined"><label slot="label" htmlFor={`reaction-code-${target.id}`}>名前</label><input id={`reaction-code-${target.id}`} value={code} maxLength={64} onChange={e=>setCode(e.target.value)} placeholder="party"/></M3eFormField><M3eFormField variant="outlined"><label slot="label" htmlFor={`reaction-url-${target.id}`}>画像URL</label><input id={`reaction-url-${target.id}`} type="url" value={url} maxLength={2048} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></M3eFormField><M3eButton type="submit" disabled={busy||snapshot.loading||!code||!url}>送信</M3eButton></form></details>
      {snapshot.loading&&<p role="status">確認中…</p>}
      {snapshot.partial&&<p role="status">一部のリレーを確認できませんでした。</p>}
      {!busy&&<M3eButton onClick={()=>session.refresh()} disabled={snapshot.loading}>再読み込み</M3eButton>}
      {error&&<p role="alert">{error}</p>}
      {busy&&<M3eButton onClick={()=>operation.current?.abort()}>中止</M3eButton>}
    </div></M3eDialog>}
  </>;
}
