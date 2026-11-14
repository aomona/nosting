'use client';
import {useEffect, useRef, useState, type ComponentRef} from 'react';
import {M3eButton} from '@m3e/react/button';
import {Plus} from 'lucide-react';
import type {useLocalMutes} from './use-local-mutes';
import MuteValue from './mute-value';
import './mute-settings.css';

export default function MuteSettings({mutes,ready,error,addUser,addWord,removeUser,removeWord}:ReturnType<typeof useLocalMutes>){
 const [editing,setEditing]=useState(false),[kind,setKind]=useState<'users'|'words'>('users'),[value,setValue]=useState(''),[status,setStatus]=useState('');
 const previousEditing=useRef(false);
 const input=useRef<HTMLInputElement>(null),add=useRef<ComponentRef<typeof M3eButton>>(null);
 useEffect(()=>{if(editing)input.current?.focus();else if(previousEditing.current)add.current?.focus();previousEditing.current=editing},[editing]);
 function closeEditor(){setEditing(false);setValue('')}
 return <section className="petal-mute-settings local-mute-settings" aria-label="この端末のミュート">
  <div className="mute-toolbar"><h3>{editing?'追加':`${mutes.users.length+mutes.words.length}件`}</h3>{!editing&&<M3eButton ref={add} variant="tonal" disabled={!ready} onClick={()=>{setEditing(true);setStatus('')}}><Plus slot="icon" size={18}/>追加</M3eButton>}</div>
  <p>このブラウザー内に、アカウント別で保存します。</p>
  {error&&<p className="mute-feedback" role="alert">{error}</p>}{status&&<p className="mute-feedback" role="status">{status}</p>}
  {editing?<form className="mute-editor" onSubmit={e=>{e.preventDefault();if((kind==='users'?addUser:addWord)(value)){closeEditor();setStatus('保存しました')}}}>
   <label htmlFor="local-mute-type">種類<select aria-label="種類" id="local-mute-type" value={kind} disabled={!ready} onChange={e=>{setKind(e.target.value as typeof kind);input.current?.focus()}}><option value="users">ユーザー</option><option value="words">ワード</option></select></label>
   <label htmlFor="local-mute-value">{kind==='users'?'ユーザーの公開鍵':'ワード'}<input ref={input} id="local-mute-value" value={value} onChange={e=>setValue(e.target.value)} maxLength={kind==='users'?64:200} autoComplete="off" autoCapitalize="off" spellCheck={false}/></label>
   <div className="mute-editor-actions"><M3eButton type="button" onClick={closeEditor}>キャンセル</M3eButton><M3eButton type="submit" variant="filled" disabled={!ready||!value.trim()}>追加</M3eButton></div>
  </form>:<ul>{mutes.users.map(key=><li key={key}><MuteValue value={key} label="ユーザー" identifier/><M3eButton disabled={!ready} onClick={()=>{if(removeUser(key))setStatus('解除しました')}} aria-label={`${key}のミュートを解除`}>解除</M3eButton></li>)}{mutes.words.map(word=><li key={word}><MuteValue value={word} label="ワード"/><M3eButton disabled={!ready} onClick={()=>{if(removeWord(word))setStatus('解除しました')}} aria-label={`${word}のミュートを解除`}>解除</M3eButton></li>)}</ul>}
 </section>;
}
