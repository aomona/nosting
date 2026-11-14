'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {ImagePlus} from 'lucide-react';
import {verifyEvent} from 'nostr-tools';
import './image-upload.css';
const MAX=30_000_000;
export default function ImageUpload({pubkey,onUploaded,onLogin,onBusy,onPending,action,disabled=false}:{pubkey:string;onUploaded:(url:string)=>void;onLogin:()=>void;onBusy:(busy:boolean)=>void;onPending:(pending:boolean)=>void;action:ReactNode;disabled?:boolean}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 const input=useRef<HTMLInputElement>(null),lock=useRef(false),abort=useRef<AbortController|null>(null),mounted=useRef(true),currentKey=useRef(pubkey);currentKey.current=pubkey;
 const pendingCallback=useRef(onPending);pendingCallback.current=onPending;
 useEffect(()=>{pendingCallback.current(!!file);return()=>pendingCallback.current(false)},[file]);
 const busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();busyCallback.current(false)}},[]);
 useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
 function select(f:File|undefined){setError('');if(!f)return;if(!['image/png','image/jpeg','image/webp','image/gif'].includes(f.type)){setError('PNG・JPEG・WebP・GIFを選んでください');return}if(!f.size||f.size>MAX){setError('画像は30 MB以下にしてください');return}setFile(f)}
 async function upload(){
  if(!file||lock.current||disabled)return;if(!pubkey){onLogin();return}
  lock.current=true;setSending(true);onBusy(true);setError('');const controller=new AbortController();abort.current=controller;let attempted=false;
  try{
   const bytes=await file.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const url=new URL('/api/uploads',window.location.origin).href;
   const signer=(window as any).nostr;if(!signer?.signEvent)throw Error('Nostr署名拡張機能が必要です');
   const event=await signer.signEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags:[['u',url],['method','POST'],['payload',hash]]});
   if(controller.signal.aborted)return;
   if(event.pubkey!==pubkey||currentKey.current!==pubkey||!verifyEvent(event)||event.kind!==27235||event.content!==''||JSON.stringify(event.tags)!==JSON.stringify([['u',url],['method','POST'],['payload',hash]]))throw Error('アップロードの署名を確認できませんでした');
   const authorization=btoa(JSON.stringify(event));attempted=true;
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':file.type,Authorization:'Nostr '+authorization},body:bytes,signal:controller.signal});
   const result:any=await response.json().catch(()=>({error:'応答を読み取れませんでした'}));
   if(!result||typeof result!=='object')throw Error('応答を読み取れませんでした');
   if(!response.ok)throw Error(typeof result.error==='string'?result.error:'アップロードできませんでした');
   const media=new URL(result.url,window.location.origin);
   if(media.origin!==window.location.origin||!media.pathname.startsWith('/api/media/'))throw Error('画像URLを確認できませんでした');
   if(mounted.current){onUploaded(media.href);setFile(null);setError('')}
  }catch(e:any){if(mounted.current)setError(controller.signal.aborted?'中断しました。送信開始後は画像が保存されている場合があります。':(e?.message||'アップロードできませんでした')+(attempted?' 応答が不明な場合、画像が保存されている可能性があります。':''))}
  finally{lock.current=false;abort.current=null;if(mounted.current)setSending(false);busyCallback.current(false)}
 }
 return <div className="petal-upload"><input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e=>{select(e.target.files?.[0]);e.target.value=''}}/>

  {file&&<div className="petal-upload-preview"><img src={preview} alt="アップロード前のプレビュー"/><div className="petal-upload-details"><p>画像は公開され、投稿を取り消しても残ります。</p><div className="petal-upload-actions"><M3eButton variant="filled" disabled={sending||disabled} onClick={upload}>{sending?'アップロード中…':'アップロード'}</M3eButton><M3eButton variant="text" onClick={()=>{if(sending)abort.current?.abort();else{setFile(null);setError('')}}}>{sending?'中断':'取り消す'}</M3eButton></div></div></div>}
  {error&&<p role="alert" className="petal-upload-error">{error}</p>}
  <div className="composer-footer"><M3eIconButton aria-label="画像を追加" title="画像を追加" disabled={disabled||sending} onClick={()=>input.current?.click()}><ImagePlus/></M3eIconButton>{action}</div>
 </div>
}
