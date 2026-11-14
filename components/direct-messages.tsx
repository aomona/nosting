'use client';
import {useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eTooltip} from '@m3e/react/tooltip';
import {ArrowLeft,ArrowUp,Check,ChevronDown,History,Inbox as InboxIcon,Info,MessageCircle,Plus,RefreshCw,SlidersHorizontal,Square,UserRound} from 'lucide-react';
import {M3eButton} from '@m3e/react/button';
import {nip19} from 'nostr-tools';
import {DmError,assertActive,DM_LIMIT,DM_TEXT_LIMIT,dmPeer,isKey,mergeDms,signDmEvent,unwrapDm,type DmSigner,type Rumor} from '../lib/direct-messages';
import {dmPublish,dmQuery} from '../lib/dm-relay';
import {deliverDm,prepareDm,resolveDmRelays,type DmContext,type PendingDm} from '../lib/dm-session';
import {normalizeRelay} from '../lib/relays';
import './direct-messages.css';
const short=(key:string)=>key.slice(0,8)+'…'+key.slice(-4);
type DmView='conversation'|'peers'|'new'|'requests'|'settings';
function DmIcon({label,children,disabled=false,active,filled=false,count,onClick}:{label:string;children:ReactNode;disabled?:boolean;active?:boolean;filled?:boolean;count?:number;onClick:(trigger:HTMLElement)=>void}){
 const id=useId();
 return <span className="dm-icon-control"><M3eIconButton id={id} aria-label={label} aria-pressed={active} title={label} variant={filled?'filled':active?'tonal':'standard'} disabled={disabled} onClick={e=>onClick(e.currentTarget as HTMLElement)}>{children}</M3eIconButton>{!!count&&<span className="dm-badge" aria-hidden="true">{count}</span>}<M3eTooltip htmlFor={id} position="below">{label}</M3eTooltip></span>
}
type Props={owner:string;lookup:string[];onLogin:()=>void};
export default function DirectMessages(props:Props){return props.owner?<Inbox key={props.owner} {...props}/>:<div className="empty"><M3eButton onClick={props.onLogin}>ログイン</M3eButton></div>}
function Inbox({owner,lookup}:Props){
 const [messages,setMessages]=useState<Rumor[]>([]),[peer,setPeer]=useState(''),[text,setText]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[allowAuth,setAllowAuth]=useState(false),[relayText,setRelayText]=useState(''),[pending,setPending]=useState<PendingDm|null>(null);
 const [accepted,setAccepted]=useState<string[]>([]),[blocked,setBlocked]=useState<string[]>([]),[panelView,setPanelView]=useState<DmView>('peers'),[peerDraft,setPeerDraft]=useState(''),[attention,setAttention]=useState(false),[statusOpen,setStatusOpen]=useState(false),[composerFocus,setComposerFocus]=useState(0),[started,setStarted]=useState(false),[until,setUntil]=useState<number|undefined>(),[historyLimited,setHistoryLimited]=useState(false);
 const panel=useRef<HTMLElement>(null),panelTrigger=useRef<HTMLElement|null>(null);
 function report(message:string,important=true){setStatus(message);setAttention(important);setStatusOpen(false)}
 function openPanel(next:DmView,trigger:HTMLElement){panelTrigger.current=trigger;setPanelView(next);requestAnimationFrame(()=>panel.current?.querySelector<HTMLElement>(next==='new'?'#dm-peer':'.dm-panel-title')?.focus())}
 function closePanel(){setPanelView(peer?'conversation':'peers');requestAnimationFrame(()=>panelTrigger.current?.focus())}
 function choosePeer(key:string){setPeer(key);setText('');setPanelView('conversation');setComposerFocus(n=>n+1)}
 function startConversation(){if(busy||pending)return;try{const key=recipient(peerDraft);if(blocked.includes(key))throw new DmError('宛先をブロックしています');choosePeer(key);setPeerDraft('')}catch(error){report(error instanceof DmError?error.message:'宛先を確認してください')}}
 useLayoutEffect(()=>{if(!composerFocus)return;const frame=requestAnimationFrame(()=>panel.current?.querySelector<HTMLTextAreaElement>('#dm-text')?.focus());return()=>cancelAnimationFrame(frame)},[composerFocus]);
 useLayoutEffect(()=>{if(!attention||!status)return;const frame=requestAnimationFrame(()=>panel.current?.querySelector('.dm-status.dm-warning')?.scrollIntoView({block:'nearest'}));return()=>cancelAnimationFrame(frame)},[attention,status]);
 const operation=useRef<AbortController|null>(null),lock=useRef(false),mounted=useRef(false);
 useLayoutEffect(()=>{mounted.current=true;queueMicrotask(()=>{if(!mounted.current)return;try{const saved=JSON.parse(localStorage.getItem('nosting-dm-policy:'+owner)||'{}');if(Array.isArray(saved.accepted))setAccepted(saved.accepted.filter(isKey).slice(0,500));if(Array.isArray(saved.blocked))setBlocked(saved.blocked.filter(isKey).slice(0,500))}catch{}});return()=>{mounted.current=false;operation.current?.abort()}},[owner]);
 // Keep the mobile scrollport above the actual navigation bar, including its safe area.
 // visualViewport also covers keyboards that resize only the visual viewport.
 useLayoutEffect(()=>{
  const main=panel.current?.closest<HTMLElement>('main.messages-view');if(!main)return;
  const nav=document.querySelector<HTMLElement>('m3e-nav-bar.mobile-nav');let frame=0;
  const update=()=>{
   main.style.setProperty('--dm-viewport-height',`${Math.min(window.innerHeight,window.visualViewport?.height??window.innerHeight)}px`);
   main.style.setProperty('--dm-nav-height',`${nav?.getBoundingClientRect().height??80}px`);
   cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(panel.current?.contains(document.activeElement)&&document.activeElement?.id==='dm-text')document.activeElement.closest('.dm-compose')?.scrollIntoView({block:'nearest'})});
  };
  const observer=new ResizeObserver(update);if(nav)observer.observe(nav,{box:'border-box'});
  window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);update();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);main.style.removeProperty('--dm-viewport-height');main.style.removeProperty('--dm-nav-height')};
 },[]);
 function policy(a:string[],b:string[]){setAccepted(a);setBlocked(b);try{localStorage.setItem('nosting-dm-policy:'+owner,JSON.stringify({accepted:a.slice(-500),blocked:b.slice(-500)}))}catch{report('受信設定を保存できません。この画面を閉じるまで有効です')}}
 async function run(action:(context:DmContext)=>Promise<void>){
  if(lock.current)return;const focusBefore=document.activeElement as HTMLElement|null;lock.current=true;setBusy(true);report('',false);const controller=new AbortController();operation.current=controller;
  try{const signer=(window as Window&{nostr?:DmSigner}).nostr;if(!signer?.nip44?.encrypt||!signer?.nip44?.decrypt||!signer.signEvent)throw new DmError('NIP-44対応の署名拡張機能が必要です');if(await signer.getPublicKey()!==owner)throw new DmError('アカウントが変わりました');assertActive(controller.signal);await action({owner,signer,signal:controller.signal,allowAuth,lookup})}
  catch(error){if(mounted.current&&!controller.signal.aborted)report(error instanceof DmError?error.message:'処理できませんでした。署名・復号の許可と接続を確認してください')}
  finally{lock.current=false;if(mounted.current){setBusy(false);requestAnimationFrame(()=>{if(!mounted.current||document.activeElement!==document.body)return;if(focusBefore?.isConnected&&!focusBefore.hasAttribute('disabled'))focusBefore.focus();else panel.current?.querySelector<HTMLElement>('#dm-text:not(:disabled),.dm-compose m3e-button:not([disabled]),.dm-panel-title')?.focus()})}}
 }
 function cancel(){operation.current?.abort();report('中断しました。送信開始後は届いている場合があります。')}
 async function receive(older=false){await run(async context=>{
  const relays=await resolveDmRelays(owner,context);setRelayText(relays.join('\n'));
  const results=await dmQuery(relays,{kinds:[1059],'#p':[owner],limit:DM_LIMIT,...(older&&until!==undefined?{until}:{})},context);
  const wraps=[...new Map(results.flatMap(r=>r.events).map(e=>[e.id,e])).values()].sort((a,b)=>b.created_at-a.created_at).slice(0,DM_LIMIT);
  const decoded:Rumor[]=[];let invalid=0;
  for(const wrap of wraps){assertActive(context.signal);try{decoded.push(await unwrapDm(wrap,owner,context.signer,context.signal))}catch{assertActive(context.signal);invalid++}}
  assertActive(context.signal);setMessages(old=>mergeDms(old,decoded));setStarted(true);
  // Inclusive cursor: overlapping pages deduplicate rumors, never skip equal timestamps silently.
  if(results.every(r=>r.ok)&&wraps.length){const next=Math.min(...wraps.map(e=>e.created_at));setHistoryLimited(older&&next===until);setUntil(next)}
  report(results.some(r=>!r.ok)?'一部のリレーから取得できませんでした。再読み込みしてください':invalid?'検証できないDMを除外しました':wraps.length?'読み込みました':'DMはありません',results.some(r=>!r.ok)||invalid>0);
 })}
 function recipient(raw=peer){let value=raw.trim().replace(/^nostr:/,'');if(value.startsWith('npub')){const decoded=nip19.decode(value);if(decoded.type==='npub')value=decoded.data}if(!isKey(value)||value===owner)throw new DmError('宛先を確認してください');return value}
 async function send(){await run(async context=>{
  const target=pending?.peer??recipient();if(blocked.includes(target))throw new DmError('宛先をブロックしています');const next=pending??await prepareDm(target,text,context);assertActive(context.signal);setPending(next);setPeer(next.peer);
  const result=await deliverDm(next,context);assertActive(context.signal);
  if(result.recipient.confirmed){setMessages(old=>mergeDms(old,[next.rumor]));policy([...new Set([...accepted,next.peer])],blocked.filter(k=>k!==next.peer))}
  const complete=result.recipient.confirmed===result.recipient.total&&result.archive.confirmed===result.archive.total;
  report(`相手 ${result.recipient.confirmed}/${result.recipient.total}・自分 ${result.archive.confirmed}/${result.archive.total} リレーで受信確認${complete?'':'。未確認分は同じDMで再試行できます'}`,!complete);
  if(complete){setPending(null);setText('')}
 })}
 async function saveRelays(){await run(async context=>{
  const urls=[...new Set(relayText.split(/\s+/).filter(Boolean).map(normalizeRelay))];if(!urls.length||urls.length>3)throw new DmError('リレーは1〜3件にしてください');
  const event=await signDmEvent(context.signer,owner,{kind:10050,created_at:Math.floor(Date.now()/1000),content:'',tags:urls.map(url=>['relay',url])},context.signal);
  const receipt=await dmPublish(lookup,event,context);report(`受信設定を ${receipt.confirmed}/${receipt.total} リレーで公開しました${receipt.confirmed<receipt.total?'。未確認のリレーがあります':''}`,receipt.confirmed<receipt.total);
 })}
 const peers=[...new Set([...(peer?[peer]:[]),...messages.map(m=>dmPeer(m,owner))])].filter(k=>!blocked.includes(k));
 const requestPeers=peers.filter(k=>!accepted.includes(k)&&messages.some(m=>dmPeer(m,owner)===k&&m.pubkey!==owner));
 const selected=messages.filter(m=>dmPeer(m,owner)===peer&&!blocked.includes(peer));
 const locked=busy||!!pending;
 const showStatus=!!status&&(attention||statusOpen||panelView==='settings');
 return <section ref={panel} className="petal-dm" aria-label="暗号化DM" onKeyDown={e=>{if(e.key==='Escape'&&panelView!=='conversation'){e.preventDefault();closePanel()}}}>
  <div className="dm-toolbar dm-navigation">
   <M3eButton className="dm-peer-selector" variant="text" aria-label={peer?`会話を選択: ${peer}`:'会話を選択'} aria-expanded={panelView==='peers'} disabled={locked} onClick={e=>panelView==='peers'&&peer?closePanel():openPanel('peers',e.currentTarget as HTMLElement)}><UserRound slot="icon" aria-hidden="true"/><span>{peer?short(peer):'会話'}</span><ChevronDown slot="trailing-icon" aria-hidden="true"/></M3eButton>
   <div className="dm-tools">
    <DmIcon label="新規会話" active={panelView==='new'} disabled={locked} onClick={trigger=>openPanel('new',trigger)}><Plus aria-hidden="true"/></DmIcon>
    <DmIcon label={`受信要求${requestPeers.length?` (${requestPeers.length})`:''}`} active={panelView==='requests'} count={requestPeers.length} disabled={locked} onClick={trigger=>openPanel('requests',trigger)}><InboxIcon aria-hidden="true"/></DmIcon>
    <DmIcon label={busy?'中断':started?'DMを更新':'DMを読み込む'} disabled={!!pending&&!busy} onClick={()=>busy?cancel():void receive()}>{busy?<Square aria-hidden="true"/>:<RefreshCw aria-hidden="true"/>}</DmIcon>
    <DmIcon label="DM設定" active={panelView==='settings'} disabled={locked} onClick={trigger=>openPanel('settings',trigger)}><SlidersHorizontal aria-hidden="true"/></DmIcon>
   </div>
  </div>
  {panelView!=='conversation'&&<div className="dm-panel">
   <div className="dm-panel-header"><h2 className="dm-panel-title" tabIndex={-1}>{({peers:'会話',new:'新規会話',requests:'受信要求',settings:'DM設定'} as const)[panelView]}</h2>{peer&&<DmIcon label="会話に戻る" onClick={closePanel}><ArrowLeft aria-hidden="true"/></DmIcon>}</div>
   {panelView==='peers'&&<div className="dm-peers">{peers.filter(k=>accepted.includes(k)||k===peer).map(k=><M3eButton key={k} variant="tonal" disabled={locked} title={k} aria-label={`会話を開く: ${k}`} onClick={()=>choosePeer(k)}><MessageCircle slot="icon" aria-hidden="true"/>{short(k)}</M3eButton>)}{!peers.some(k=>accepted.includes(k)||k===peer)&&<p className="dm-empty">{started?'会話はまだありません':'更新してDMを読み込む'}</p>}</div>}
   {panelView==='new'&&<form className="dm-new" onSubmit={e=>{e.preventDefault();startConversation()}}><input id="dm-peer" aria-label="宛先の公開鍵" placeholder="npub / 公開鍵" autoComplete="off" value={peerDraft} disabled={locked} onChange={e=>setPeerDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229&&!e.repeat)startConversation()}}}/><M3eButton type="button" variant="filled" disabled={locked||!peerDraft.trim()} onClick={startConversation}>会話を開く</M3eButton></form>}
   {panelView==='requests'&&<div className="dm-requests">{requestPeers.length?requestPeers.map(k=><article className="dm-request" key={k}><span title={k}>{short(k)}</span><M3eButton disabled={locked} onClick={()=>{policy([...accepted,k],blocked);choosePeer(k)}}>許可</M3eButton><M3eButton disabled={locked} onClick={()=>{policy(accepted.filter(v=>v!==k),[...blocked,k]);setMessages(old=>old.filter(m=>dmPeer(m,owner)!==k))}}>ブロック</M3eButton></article>):<p className="dm-empty">受信要求はありません</p>}</div>}
   {panelView==='settings'&&<div className="dm-settings"><label className="dm-auth"><input type="checkbox" checked={allowAuth} disabled={busy} onChange={e=>setAllowAuth(e.target.checked)}/><span>接続先にアカウントを認証（NIP-42）</span></label><label htmlFor="dm-relays">受信リレー</label><textarea id="dm-relays" rows={3} placeholder="wss://…" value={relayText} disabled={busy} onChange={e=>setRelayText(e.target.value)}/><p className="dm-setting-note">受信リレーの設定は公開されます。</p><M3eButton disabled={busy||!relayText.trim()||!lookup.length} onClick={()=>void saveRelays()}>受信設定を公開</M3eButton>{blocked.map(k=><div key={k}>{short(k)} <M3eButton disabled={busy} onClick={()=>policy(accepted,blocked.filter(v=>v!==k))}>ブロック解除</M3eButton></div>)}</div>}
  </div>}
  {panelView==='conversation'&&peer&&<>
   <div className="dm-history-tools">{until!==undefined&&<DmIcon label="過去のDMを読み込む" disabled={busy||historyLimited||messages.length>=500} onClick={()=>void receive(true)}><History aria-hidden="true"/></DmIcon>}</div>
   <div className="dm-history" aria-label="メッセージ履歴">{accepted.includes(peer)&&selected.map(m=><article className={'dm-message'+(m.pubkey===owner?' own':'')} key={m.id}><p>{m.content}</p><time dateTime={new Date(m.created_at*1000).toISOString()}>{new Date(m.created_at*1000).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></article>)}</div>
   {blocked.includes(peer)?<p>この相手をブロックしています</p>:<div className="dm-compose"><textarea id="dm-text" aria-label="メッセージ" aria-keyshortcuts="Control+Enter Meta+Enter" placeholder="メッセージ" onFocus={e=>e.currentTarget.closest('.dm-compose')?.scrollIntoView({block:'nearest'})} rows={2} maxLength={DM_TEXT_LIMIT} value={text} disabled={locked} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229&&!e.repeat){e.preventDefault();if(!busy&&(pending||text.trim()))void send()}}}/><div className="dm-compose-actions">{status&&!attention&&<DmIcon label="操作結果の詳細" active={statusOpen} onClick={()=>setStatusOpen(v=>!v)}><Check aria-hidden="true"/></DmIcon>}{pending?<M3eButton variant="filled" disabled={busy} onClick={()=>void send()}>{busy?'送信中':'同じDMを再送'}</M3eButton>:<DmIcon label="暗号化して送信" filled disabled={busy||!text.trim()} onClick={()=>void send()}><ArrowUp aria-hidden="true"/></DmIcon>}</div></div>}
   {pending&&!busy&&<M3eButton className="dm-stop-retry" variant="text" onClick={()=>{setPending(null);setText('');report('再送を終了しました。送信済みのDMは削除されません。')}}>再送を終了</M3eButton>}
  </>}
  {messages.length>=500&&<p className="dm-warning">履歴の表示上限（500件）に達しました。</p>}{historyLimited&&<p className="dm-warning">同時刻の履歴が取得上限に達しました。</p>}
  {status&&<div className={'dm-status'+(attention?' dm-warning':'')}>{(attention||panelView!=='conversation')&&<div className="dm-status-control"><DmIcon label="操作結果の詳細" active={statusOpen} onClick={()=>setStatusOpen(v=>!v)}>{attention?<Info aria-hidden="true"/>:<Check aria-hidden="true"/>}</DmIcon></div>}{showStatus&&<p>{status}</p>}<span className="dm-sr-only" role={attention?'alert':'status'}>{attention?status:status.startsWith('相手 ')?'送信を確認しました':status}</span></div>}
 </section>
}
