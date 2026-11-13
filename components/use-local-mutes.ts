'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {addLocalMute,emptyMutes,isEventMuted,muteStorageKey,parseMutes,type LocalMutes} from '../lib/mutes';
export function useLocalMutes(pubkey:string){
 const key=muteStorageKey(pubkey);
 const [state,setState]=useState<{key:string;mutes:LocalMutes}>({key:'',mutes:emptyMutes()});
 // Event-time snapshot, updated before React renders, preserves rapid/batched edits.
 const current=useRef(state);
 const [error,setError]=useState('');
 useEffect(()=>{function load(){let next:LocalMutes;try{next=parseMutes(JSON.parse(localStorage.getItem(key)||'null'));setError('')}catch{next=emptyMutes();setError('ミュート設定を読み込めませんでした。')}current.current={key,mutes:next};setState(current.current)}load();const changed=(e:StorageEvent)=>{if(e.key===key||e.key===null)load()};window.addEventListener('storage',changed);return()=>{window.removeEventListener('storage',changed);current.current={key:'',mutes:emptyMutes()}}},[key]);
 const ready=state.key===key;
 const mutes=ready?state.mutes:emptyMutes();
 const change=useCallback((fn:(old:LocalMutes)=>{mutes:LocalMutes;error?:string})=>{if(current.current.key!==key)return false;const result=fn(current.current.mutes);if(result.error){setError(result.error);return false}const next=parseMutes(result.mutes);current.current={key,mutes:next};setState(current.current);try{localStorage.setItem(key,JSON.stringify(next));setError('')}catch{setError('保存できませんでした。このタブでのみ有効です。')}return true},[key]);
 const addUser=(value:string)=>change(old=>addLocalMute(old,'users',value));
 const addWord=(value:string)=>change(old=>addLocalMute(old,'words',value));
 const isMuted=useCallback((event:Parameters<typeof isEventMuted>[0])=>state.key!==key||isEventMuted(event,state.mutes),[state,key]);
 return {mutes,ready,error,addUser,addWord,removeUser:(user:string)=>change(old=>({mutes:{...old,users:old.users.filter(s=>s!==user)}})),removeWord:(word:string)=>change(old=>({mutes:{...old,words:old.words.filter(s=>s!==word)}})),isMuted};
}
