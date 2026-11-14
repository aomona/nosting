'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import {nip19} from 'nostr-tools';
import {DmError,assertActive,DM_LIMIT,DM_TEXT_LIMIT,dmPeer,isKey,mergeDms,signDmEvent,unwrapDm,type DmSigner,type Rumor} from '../lib/direct-messages';
import {dmPublish,dmQuery} from '../lib/dm-relay';
import {deliverDm,prepareDm,resolveDmRelays,type DmContext,type PendingDm} from '../lib/dm-session';
import {normalizeRelay} from '../lib/relays';
import './direct-messages.css';
const short=(key:string)=>key.slice(0,12)+'…'+key.slice(-6);
type Props={owner:string;lookup:string[];onLogin:()=>void};
export default function DirectMessages(props:Props){return props.owner?<Inbox key={props.owner} {...props}/>:<div className="empty"><M3eButton onClick={props.onLogin}>ログイン</M3eButton></div>}
function Inbox({owner,lookup}:Props){
 const [messages,setMessages]=useState<Rumor[]>([]),[peer,setPeer]=useState(''),[text,setText]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[allowAuth,setAllowAuth]=useState(false),[relayText,setRelayText]=useState(''),[pending,setPending]=useState<PendingDm|null>(null);
 const [accepted,setAccepted]=useState<string[]>([]),[blocked,setBlocked]=useState<string[]>([]),[requests,setRequests]=useState(false),[started,setStarted]=useState(false),[until,setUntil]=useState<number|undefined>(),[historyLimited,setHistoryLimited]=useState(false);
 const operation=useRef<AbortController|null>(null),lock=useRef(false),mounted=useRef(false);
 useLayoutEffect(()=>{mounted.current=true;queueMicrotask(()=>{if(!mounted.current)return;try{const saved=JSON.parse(localStorage.getItem('nosting-dm-policy:'+owner)||'{}');if(Array.isArray(saved.accepted))setAccepted(saved.accepted.filter(isKey).slice(0,500));if(Array.isArray(saved.blocked))setBlocked(saved.blocked.filter(isKey).slice(0,500))}catch{}});return()=>{mounted.current=false;operation.current?.abort()}},[owner]);
 function policy(a:string[],b:string[]){setAccepted(a);setBlocked(b);try{localStorage.setItem('nosting-dm-policy:'+owner,JSON.stringify({accepted:a.slice(-500),blocked:b.slice(-500)}))}catch{setStatus('受信設定を保存できません。この画面を閉じるまで有効です')}}
 async function run(action:(context:DmContext)=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setStatus('');const controller=new AbortController();operation.current=controller;
  try{const signer=(window as Window&{nostr?:DmSigner}).nostr;if(!signer?.nip44?.encrypt||!signer?.nip44?.decrypt||!signer.signEvent)throw new DmError('NIP-44対応の署名拡張機能が必要です');if(await signer.getPublicKey()!==owner)throw new DmError('アカウントが変わりました');assertActive(controller.signal);await action({owner,signer,signal:controller.signal,allowAuth,lookup})}
  catch(error){if(mounted.current&&!controller.signal.aborted)setStatus(error instanceof DmError?error.message:'処理できませんでした。署名・復号の許可と接続を確認してください')}
  finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 function cancel(){operation.current?.abort();setStatus('中断しました。送信開始後は届いている場合があります。')}
 async function receive(older=false){await run(async context=>{
  const relays=await resolveDmRelays(owner,context);setRelayText(relays.join('\n'));
  const results=await dmQuery(relays,{kinds:[1059],'#p':[owner],limit:DM_LIMIT,...(older&&until!==undefined?{until}:{})},context);
  const wraps=[...new Map(results.flatMap(r=>r.events).map(e=>[e.id,e])).values()].sort((a,b)=>b.created_at-a.created_at).slice(0,DM_LIMIT);
  const decoded:Rumor[]=[];let invalid=0;
  for(const wrap of wraps){assertActive(context.signal);try{decoded.push(await unwrapDm(wrap,owner,context.signer,context.signal))}catch{assertActive(context.signal);invalid++}}
  assertActive(context.signal);setMessages(old=>mergeDms(old,decoded));setStarted(true);
  // Inclusive cursor: overlapping pages deduplicate rumors, never skip equal timestamps silently.
  if(results.every(r=>r.ok)&&wraps.length){const next=Math.min(...wraps.map(e=>e.created_at));setHistoryLimited(older&&next===until);setUntil(next)}
  setStatus(results.some(r=>!r.ok)?'一部のリレーから取得できませんでした。再読み込みしてください':invalid?'検証できないDMを除外しました':wraps.length?'読み込みました':'DMはありません');
 })}
 function recipient(){let value=peer.trim().replace(/^nostr:/,'');if(value.startsWith('npub')){const decoded=nip19.decode(value);if(decoded.type==='npub')value=decoded.data}if(!isKey(value)||value===owner)throw new DmError('宛先を確認してください');return value}
 async function send(){await run(async context=>{
  const target=pending?.peer??recipient();if(blocked.includes(target))throw new DmError('宛先をブロックしています');const next=pending??await prepareDm(target,text,context);assertActive(context.signal);setPending(next);setPeer(next.peer);
  const result=await deliverDm(next,context);assertActive(context.signal);
  if(result.recipient.confirmed){setMessages(old=>mergeDms(old,[next.rumor]));policy([...new Set([...accepted,next.peer])],blocked.filter(k=>k!==next.peer))}
  const complete=result.recipient.confirmed===result.recipient.total&&result.archive.confirmed===result.archive.total;
  setStatus(`相手 ${result.recipient.confirmed}/${result.recipient.total}・自分 ${result.archive.confirmed}/${result.archive.total} リレーで受信確認${complete?'':'。未確認分は同じDMで再試行できます'}`);
  if(complete){setPending(null);setText('')}
 })}
 async function saveRelays(){await run(async context=>{
  const urls=[...new Set(relayText.split(/\s+/).filter(Boolean).map(normalizeRelay))];if(!urls.length||urls.length>3)throw new DmError('リレーは1〜3件にしてください');
  const event=await signDmEvent(context.signer,owner,{kind:10050,created_at:Math.floor(Date.now()/1000),content:'',tags:urls.map(url=>['relay',url])},context.signal);
  const receipt=await dmPublish(lookup,event,context);setStatus(`受信設定を ${receipt.confirmed}/${receipt.total} リレーで公開しました`);
 })}
 const peers=[...new Set(messages.map(m=>dmPeer(m,owner)))].filter(k=>!blocked.includes(k));
 const requestPeers=peers.filter(k=>!accepted.includes(k));const listed=peers.filter(k=>requests?!accepted.includes(k):accepted.includes(k));
 const selected=messages.filter(m=>dmPeer(m,owner)===peer&&!blocked.includes(peer));
 return <section className="petal-dm" aria-label="暗号化DM">
  <div className="dm-toolbar"><M3eButton variant="tonal" disabled={busy} onClick={()=>void receive()}>{started?'更新':'DMを読み込む'}</M3eButton>{busy&&<M3eButton onClick={cancel}>中断</M3eButton>}</div>
  <details className="dm-settings"><summary>DM設定</summary><label><input type="checkbox" checked={allowAuth} disabled={busy} onChange={e=>setAllowAuth(e.target.checked)}/>接続先にアカウントを認証（NIP-42）</label><label htmlFor="dm-relays">受信リレー</label><textarea id="dm-relays" rows={3} placeholder="wss://…" value={relayText} disabled={busy} onChange={e=>setRelayText(e.target.value)}/><M3eButton disabled={busy||!relayText.trim()||!lookup.length} onClick={()=>void saveRelays()}>受信設定を公開</M3eButton>{blocked.map(k=><div key={k}>{short(k)} <M3eButton disabled={busy} onClick={()=>policy(accepted,blocked.filter(v=>v!==k))}>ブロック解除</M3eButton></div>)}</details>
  <div className="dm-tabs"><M3eButton variant={requests?'text':'tonal'} aria-pressed={!requests} onClick={()=>setRequests(false)}>メッセージ</M3eButton><M3eButton variant={requests?'tonal':'text'} aria-pressed={requests} onClick={()=>setRequests(true)}>受信要求 {requestPeers.length||''}</M3eButton></div>
  <div className="dm-peers">{listed.map(k=><M3eButton key={k} variant={peer===k?'tonal':'text'} disabled={busy||!!pending} onClick={()=>{setPeer(k);setText('')}}>{short(k)}</M3eButton>)}</div>
  {requests?listed.map(k=><article className="dm-request" key={k}><span>{short(k)}</span><M3eButton disabled={busy||!!pending} onClick={()=>{policy([...accepted,k],blocked);setPeer(k);setRequests(false)}}>許可</M3eButton><M3eButton disabled={busy||!!pending} onClick={()=>{policy(accepted.filter(v=>v!==k),[...blocked,k]);setMessages(old=>old.filter(m=>dmPeer(m,owner)!==k))}}>ブロック</M3eButton></article>):<>
  <label htmlFor="dm-peer">宛先</label><input id="dm-peer" placeholder="npub / 公開鍵" autoComplete="off" value={peer} disabled={busy||!!pending} onChange={e=>{setPeer(e.target.value);setText('')}}/>
  <div className="dm-history" aria-label="メッセージ履歴">{accepted.includes(peer)&&selected.map(m=><article className={'dm-message'+(m.pubkey===owner?' own':'')} key={m.id}><p>{m.content}</p><time dateTime={new Date(m.created_at*1000).toISOString()}>{new Date(m.created_at*1000).toLocaleString('ja-JP')}</time></article>)}</div>
  {blocked.includes(peer)?<p>この相手をブロックしています</p>:<><label htmlFor="dm-text">メッセージ</label><textarea id="dm-text" rows={3} maxLength={DM_TEXT_LIMIT} value={text} disabled={busy||!!pending} onChange={e=>setText(e.target.value)}/><div className="dm-toolbar"><M3eButton variant="filled" disabled={busy||(!pending&&(!text.trim()||!peer.trim()))} onClick={()=>void send()}>{pending?'同じDMを再送':'暗号化して送信'}</M3eButton>{pending&&!busy&&<M3eButton onClick={()=>{setPending(null);setText('');setStatus('再送を終了しました。送信済みのDMは削除されません。')}}>再送を終了</M3eButton>}</div></>}
  </>}
  {until!==undefined&&<M3eButton disabled={busy||historyLimited||messages.length>=500} onClick={()=>void receive(true)}>過去のDMを読み込む</M3eButton>}{messages.length>=500&&<p>履歴の表示上限（500件）に達しました。</p>}{historyLimited&&<p>同時刻の履歴が取得上限に達しました。</p>}
  {status&&<p role="status">{status}</p>}
 </section>
}
