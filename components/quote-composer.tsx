'use client';
import {useEffect,useRef,useState} from 'react';
import type {Event} from 'nostr-tools';
import {M3eButton} from '@m3e/react/button';
import {M3eCard} from '@m3e/react/card';
import {M3eFormField} from '@m3e/react/form-field';
import {ArrowUpRight,Quote} from 'lucide-react';
import {useLocalDraft} from './local-draft';
import NoteContent from './note-content';
import './quote-composer.css';

type Source=Pick<Event,'id'|'pubkey'|'content'|'tags'>;
export default function QuoteComposer({source,name,busy,onSend,onClose}:{source:Source;name:string;busy:boolean;onSend:(text:string)=>Promise<boolean>;onClose:()=>void}){
 const draft=useLocalDraft('quote:'+source.id);
 const [sending,setSending]=useState(false),[error,setError]=useState('');
 const locked=useRef(false),mounted=useRef(true),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{mounted.current=true;input.current?.focus({preventScroll:true});return()=>{mounted.current=false}},[]);
 async function send(){
  if(!draft.text.trim()||busy||locked.current)return;
  locked.current=true;setSending(true);setError('');
  const text=draft.text;
  try{
   if(await onSend(text)){draft.accepted(text);if(mounted.current)onClose()}
   else if(mounted.current)setError('送信を確認できませんでした。下書きは残っています。');
  }catch{if(mounted.current)setError('送信できませんでした。下書きは残っています。')}
  finally{locked.current=false;if(mounted.current)setSending(false)}
 }
 const disabled=busy||sending;
 return <form className="quote-composer" aria-label="引用投稿" aria-busy={sending} onSubmit={e=>{e.preventDefault();void send()}}>
  <M3eFormField variant="outlined" hideSubscript="always" className="quote-composer-field">
   <textarea ref={input} aria-label="引用の本文" aria-describedby={error?'quote-send-error':undefined} placeholder="コメントを追加…" maxLength={4000} rows={4} value={draft.text} readOnly={disabled} onChange={e=>{draft.setText(e.target.value);setError('')}} onKeyDown={e=>{if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||e.repeat)return;if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void send()}}}/>
  </M3eFormField>
  <M3eCard variant="outlined" className="quote-composer-source"><div className="quote-composer-source-inner">
   <div className="quote-composer-author"><Quote size={20} aria-hidden="true"/><span>{name}</span></div>
   <NoteContent content={source.content} tags={source.tags} noteId={source.id} quoteDepth={1}/>
  </div></M3eCard>
  {!draft.saved&&<p className="draft-status">保存できません。閉じる前にコピーしてください</p>}
  {error&&<p id="quote-send-error" role="alert" className="quote-composer-error">{error}</p>}
  <div className="quote-composer-actions"><M3eButton type="button" variant="text" disabled={disabled} onClick={onClose}>閉じる</M3eButton><M3eButton type="button" variant="filled" disabled={disabled||!draft.text.trim()} onClick={()=>void send()}>{sending?'送信中…':'署名して引用'}<ArrowUpRight slot="trailing-icon" aria-hidden="true" size={20}/></M3eButton></div>
 </form>;
}
