'use client';
import {useState} from 'react';
import type {useLocalMutes} from './use-local-mutes';
import './mute-settings.css';
export default function MuteSettings({mutes,ready,error,addUser,addWord,removeUser,removeWord}:ReturnType<typeof useLocalMutes>){
 const [user,setUser]=useState(''),[word,setWord]=useState('');
 return <section className="petal-mute-settings" aria-label="ローカルミュート"><h3>ミュート</h3><p>このブラウザーの現在のアカウントだけに保存します。リレーへ公開しません。未ログイン時の設定は別に保存します。</p><form onSubmit={e=>{e.preventDefault();if(addUser(user))setUser('')}}><label htmlFor="mute-user">ユーザーの公開鍵（hex）</label><div><input id="mute-user" value={user} onChange={e=>setUser(e.target.value)} maxLength={64} autoComplete="off"/><button disabled={!ready||!user.trim()} type="submit">追加</button></div></form><ul>{mutes.users.map(key=><li key={key}><span>{key}</span><button onClick={()=>removeUser(key)} aria-label={`${key}のミュートを解除`}>解除</button></li>)}</ul><form onSubmit={e=>{e.preventDefault();if(addWord(word))setWord('')}}><label htmlFor="mute-word">ミュートワード（大文字・小文字を区別しません）</label><div><input id="mute-word" value={word} onChange={e=>setWord(e.target.value)} maxLength={200}/><button disabled={!ready||!word.trim()} type="submit">追加</button></div></form><ul>{mutes.words.map(value=><li key={value}><span>{value}</span><button onClick={()=>removeWord(value)} aria-label={`${value}のミュートを解除`}>解除</button></li>)}</ul>{error&&<p role="alert">{error}</p>}</section>;
}
