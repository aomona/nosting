'use client';
import {RouteHistory,type AppRoute,type ScrollAnchor} from '../lib/app-route';
import {DraftOwnerContext,useAccountDraft} from './local-draft';
import WindowedFeed from './windowed-feed';
import {FEED_LIMIT,retainFeed,retainProfiles} from '../lib/feed-retention';
import {RelayListDiscovery,parseRelayList} from '../lib/relay-discovery';
import AccountRelayEditor from './account-relay-editor';
import {AccountRelaySession,accountConnections,readGuestConnections,saveGuestConnections,withTemporaryReaders,relayLookupUrls,loadAccountRelayList,saveAccountRelayList,publishAccountRelayList,type AccountRelayState} from '../lib/account-relays';
import {useLocalMutes} from './use-local-mutes';
import MuteSettings from './mute-settings';
import {MuteContext} from './mute-context';
import {ProfileSnapshots} from '../lib/profile-snapshots';
import {MentionContext} from './mention';
import {LoginSession,type LoginDestination,type LoginResult} from '../lib/login-session';
import {rememberedLogin,rememberLogin,restoreLogin} from '../lib/login-remember';
import EmojiText from './custom-emoji';
import {RelaySearch,type SearchResult} from '../lib/relay-search';
import {supportsSearch} from '../lib/relay-capabilities';
import Nip05Search from './nip05-search';
import SearchStatus from './search-status';
import Loading from './loading';
import {InitialFeed} from '../lib/initial-feed';
import ThreadDetail from './thread-detail';
import {makeReplyTags} from '../lib/reply-tags';
import NotificationFeed from './notification-feed';
import {useFollowingFeed,FollowingHistory} from './following-feed';
import {nip19,verifyEvent,type Event as NostrEvent,type EventTemplate} from 'nostr-tools';
import {TimelineReposts} from '../lib/timeline-reposts';
import './timeline-reposts.css';
import {QuoteResolver} from '../lib/quotes';
import {QuoteContext,QuoteOpenContext} from './quote-card';
import StickyHeader from './sticky-header';
import {RelayConnections,RelayPublisher} from '../lib/relay-connections';
import InlineReply from './inline-reply';
import {ReplyContext,ReplyPreview,ReplyRecipient} from './reply-context';
import ImageUpload from './image-upload';
import {HistoryPager} from '../lib/history-pager';
import ProfileAvatar from './profile-avatar';
import ProfileHeader from './profile-header';
import FollowButton from './follow-button';
import {loadFollowList,saveFollowChange,followedKeys} from '../lib/follow-list';
import ProfileEditor from './profile-editor';
import {loadEditableProfile,saveProfileEdit,type EditableProfile,type ProfileDraft} from '../lib/profile-edit';
import {readProfile,newerProfile,type Profile} from '../lib/profiles';
import {M3eCard} from '@m3e/react/card';
import RelayEditor,{type RelayEditorHandle} from './relay-editor';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './ui/dropdown-menu';
import './profile-menu.css';
import {DEFAULT_RELAYS,canRead,canWrite,type RelayConfig} from '../lib/relays';
import NoteContent from './note-content';
import NoteTime from './note-time';
import {shareNote} from '../lib/share-note';
import ZapPanel from './deferred-zap';
import {findRepostSource,repostPayload} from '../lib/repost';
import {buildContentTags} from '../lib/publication-tags';
import {quotePost} from '../lib/quote-post';
import QuoteComposer from './quote-composer';
import RepostMenu from './repost-menu';
import {isLatestReplaceable} from '../lib/latest-event';
import {M3eActionList,M3eListAction} from '@m3e/react/list';
import {M3eDialog} from '@m3e/react/dialog';
import {focusWhenReady} from '@m3e/web/core';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eButtonGroup} from '@m3e/react/button-group';
import {M3eTheme} from '@m3e/react/theme';
import {M3eNavBar,M3eNavItem} from '@m3e/react/nav-bar';
import {M3eNavMenu,M3eNavMenuItem} from '@m3e/react/nav-menu';
import {memo,useContext,useEffect,useEffectEvent,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {Home,Search,Bookmark,Settings,ArrowUpRight,Plus,Heart,MessageCircle,Repeat2,Copy,Share2,Zap,Bell,Radio,ArrowRight,ArrowLeft,X,Sun,Moon,Check,Send,Link,ChevronDown,LogOut,Flower2,SlidersHorizontal,UserRound,MoreHorizontal,VolumeX,RefreshCw} from 'lucide-react';
type Note=Omit<NostrEvent,'sig'>&{sig?:string};

function short(s:string){return s.slice(0,8)+'…'+s.slice(-4)}

type NoteActions={openDetail:(n:Note,rowId?:string)=>void;openReference:(id:string)=>void;profile:(key:string)=>void;openReply:(n:Note,rowId?:string)=>void;repost:(n:Note,signal:AbortSignal,close:()=>void)=>Promise<boolean>;quote:(n:Note,signal:AbortSignal,close:()=>void)=>Promise<boolean>;like:(n:Note)=>void;save:(id:string)=>void;share:(n:Note)=>void;zap:(n:Note)=>void;cancelReply:(n:Note,rowId?:string)=>void;send:(n:Note,text:string)=>Promise<boolean>};
const NoteRow=memo(function NoteRow({n,rowId=n.id,repost,reposter,profile,replyOpen,isLiked,isSaved,busy,actions}:{n:Note;rowId?:string;repost?:Note;reposter?:Profile;profile?:Profile;replyOpen:boolean;isLiked:boolean;isSaved:boolean;busy:boolean;actions:RefObject<NoteActions>}){
 const draftOwner=useContext(DraftOwnerContext);
 const name=profile?.display_name||profile?.name||short(n.pubkey);
 return <ReplyContext event={n}><article className="note note-row" data-note-id={rowId} key={n.id} tabIndex={0} aria-label={`${name}の投稿。Enterで返信一覧を開く`} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();actions.current.openDetail(n,rowId)}}} onClick={e=>{if(window.getSelection()?.toString())return;const target=e.target as Element;const link=target.closest('a');if(link){const href=link.getAttribute('href')||'';if(href.startsWith('nostr:'))try{const d=nip19.decode(href.slice(6));if(d.type==='note'||d.type==='nevent'){e.preventDefault();actions.current.openReference(d.type==='note'?d.data:d.data.id)}}catch{}return}if(target.closest('button,input,textarea,select,video,audio,img,[role="button"],[contenteditable],m3e-icon-button,m3e-button,.petal-quote'))return;actions.current.openDetail(n,rowId)}}>{repost&&<div className="repost-attribution"><Repeat2 size={16} aria-hidden="true"/><button type="button" onClick={()=>actions.current.profile(repost.pubkey)}><EmojiText text={reposter?.display_name||reposter?.name||short(repost.pubkey)} emojis={reposter?.emojis}/> がリポスト</button></div>}<ReplyPreview/><button type="button" className="avatar-link" aria-label={`${name}のプロフィール`} onClick={()=>actions.current.profile(n.pubkey)}><ProfileAvatar picture={profile?.picture} name={name}/></button><div className="note-content"><div className="note-head"><button className="author-name" onClick={()=>actions.current.profile(n.pubkey)} aria-label={name}><EmojiText text={name} emojis={profile?.emojis}/></button><span>@<EmojiText text={profile?.name||short(n.pubkey)} emojis={profile?.emojis}/></span><a className="note-permalink" href={'#/thread/'+n.id} aria-label="この投稿の直リンク" onClick={e=>{e.preventDefault();actions.current.openDetail(n,rowId)}}><NoteTime createdAt={n.created_at}/></a></div><ReplyRecipient/><NoteContent content={n.content} tags={n.tags} noteId={n.id}/><div className="actions"><M3eIconButton title="返信" aria-label="返信" data-reply-for={rowId} aria-expanded={replyOpen?'true':'false'} aria-controls={replyOpen?'reply-'+rowId:undefined} onClick={()=>actions.current.openReply(n,rowId)}><MessageCircle size={18}/></M3eIconButton><RepostMenu onRepost={(signal,close)=>actions.current.repost(n,signal,close)} onQuote={(signal,close)=>actions.current.quote(n,signal,close)}/><M3eIconButton aria-pressed={isLiked?'true':'false'} className={isLiked?'liked':''} title="いいね" aria-label="いいね" onClick={()=>actions.current.like(n)}><Heart size={18} fill={isLiked?'currentColor':'none'}/></M3eIconButton><M3eIconButton title="ブックマーク" aria-label="ブックマーク" aria-pressed={isSaved?'true':'false'} className={isSaved?'saved':''} onClick={()=>actions.current.save(n.id)}><Bookmark size={18} fill={isSaved?'currentColor':'none'}/></M3eIconButton><M3eIconButton title="Zap" aria-label="Zap" onClick={()=>actions.current.zap(n)}><Zap size={18}/></M3eIconButton><M3eIconButton title="シェア" aria-label="シェア" onClick={()=>actions.current.share(n)}><Share2 size={18}/></M3eIconButton></div></div>{replyOpen&&<InlineReply key={draftOwner} noteId={n.id} instanceId={rowId} name={name} busy={busy} onCancel={()=>actions.current.cancelReply(n,rowId)} onSend={text=>actions.current.send(n,text)}/>}</article></ReplyContext>;
});

// Preserve the feed DOM and keyed NoteRow instances; skip mapping/reconciling
// the entire list when only composer, toast, modal, or other parent UI changes.
export function NoteList({notes,originals,profiles,replySet,likedSet,bookmarkSet,busy,actions,lightweight=false,restoreAnchor,onFallback}:{notes:Note[];originals:Record<string,NostrEvent>;profiles:Record<string,Profile>;replySet:Set<string>;likedSet:Set<string>;bookmarkSet:Set<string>;busy:boolean;actions:RefObject<NoteActions>;lightweight?:boolean;restoreAnchor?:ScrollAnchor|null;onFallback?:()=>void}){
 return <WindowedFeed items={notes} enabled={lightweight} pinnedIds={replySet} restoreAnchor={restoreAnchor} onFallback={onFallback} renderItem={n=>{const original=n.kind===6?originals[n.id]:n;return original?<NoteRow key={n.id} rowId={n.id} n={original} repost={n.kind===6?n:undefined} reposter={n.kind===6?profiles[n.pubkey]:undefined} profile={profiles[original.pubkey]} replyOpen={replySet.has(n.id)} isLiked={likedSet.has(original.id)} isSaved={bookmarkSet.has(original.id)} busy={busy&&replySet.has(n.id)} actions={actions}/>:null}}/>;
}
export const MemoizedNoteList=memo(NoteList);

export default function App(){
 const [relays,setRelays]=useState<RelayConfig[]>(DEFAULT_RELAYS);
 const activeRelays=useRef<RelayConfig[]>(DEFAULT_RELAYS);
 const guestRelays=useRef<RelayConfig[]|null>(null);
 const temporaryReaders=useRef<{author:string;urls:string[]}>({author:'',urls:[]});
 const relayAccountAbort=useRef(new AbortController());
 const [accountRelayState,setAccountRelayState]=useState<AccountRelayState>({owner:'',event:null,partial:true,loading:false});
 const accountRelayUpdate=useRef<(state:AccountRelayState)=>void>(()=>{});
 const accountRelays=useRef<AccountRelaySession|null>(null);
 const zapReadRelays=useMemo(()=>relays.filter(r=>r.read).map(r=>r.url),[relays]);
 const [view,setView]=useState('home'),[tab,setTab]=useState('すべて'),[dark,setDark]=useState(false),[themeReady,setThemeReady]=useState(false),[notes,setNotes]=useState<Note[]>([]),[q,setQ]=useState(''),[pubkey,setPubkey]=useState(''),[modal,setModal]=useState(''),[toast,setToast]=useState(''),[busy,setBusy]=useState(false),[reply,setReply]=useState<Note|null>(null),[bookmarks,setBookmarks]=useState<string[]>([]),[liked,setLiked]=useState<string[]>([]),[statuses,setStatuses]=useState<Record<string,string>>({}),[follows,setFollows]=useState<string[]>([]),[profiles,setProfiles]=useState<Record<string,Profile>>({});
 const followingActive=view==='home'&&tab==='フォロー中';
 const following=useFollowingFeed(pubkey,follows,zapReadRelays,followingActive);
 const inboxRelays=useMemo(()=>accountRelayState.owner===pubkey&&accountRelayState.event?parseRelayList(accountRelayState.event).filter(r=>r.read).map(r=>r.url):[],[accountRelayState.owner,accountRelayState.event,pubkey]);
 const localMutes=useLocalMutes(pubkey);
 const [lightweight,setLightweight]=useState(false);
 const lightweightFallback=useMemo(()=>()=>setLightweight(false),[]);
 const relayDiscovery=useRef(new RelayListDiscovery());
 const composerDraft=useAccountDraft(pubkey);const draft=composerDraft.text,setDraft=composerDraft.setText;
 const routeHistory=useRef<RouteHistory|null>(null),routeApply=useRef<(route:AppRoute,y:number,anchor:ScrollAnchor|null)=>void>(()=>{});
 const routeEvents=useRef(new Map<string,NostrEvent>()),pendingThread=useRef('');
 const [feedRestore,setFeedRestore]=useState<ScrollAnchor|null>(null);
 const [detailError,setDetailError]=useState('');
 const navigationEpoch=useRef(0);
 const scrollRestore=useRef<(()=>void)|null>(null);
 const [nip05Query,setNip05Query]=useState<{query:string;id:number}|null>(null);
 const searcher=useRef(new RelaySearch()),searchEpoch=useRef(0);
 const [searchResult,setSearchResult]=useState<SearchResult|null>(null),[searchChecking,setSearchChecking]=useState(false);
 const [uploading,setUploading]=useState(false),[attachmentPending,setAttachmentPending]=useState(false);
 const [zapNote,setZapNote]=useState<Note|null>(null);
 const [openReplies,setOpenReplies]=useState<string[]>([]);
 const [detail,setDetail]=useState<NostrEvent|null>(null);
 const detailRequest=useRef(0);
 const [profileKey,setProfileKey]=useState(''),[authorNotes,setAuthorNotes]=useState<Note[]>([]),[profileLoading,setProfileLoading]=useState(false);
 const initialFeed=useRef(new InitialFeed()),[initialLoading,setInitialLoading]=useState(true);
 const homePager=useRef(new HistoryPager([1,6])),authorPager=useRef(new HistoryPager());
 const authorCache=useRef(new Map<string,{notes:Note[];cursors:HistoryPager['cursors'];failed:Set<string>}>());
 const [paging,setPaging]=useState<{loading:boolean;error:string;done:boolean;warning?:string}>({loading:false,error:'',done:false});const sentinel=useRef<HTMLDivElement>(null),screen=useRef('');screen.current=view==='profile'?'profile:'+profileKey:view;
 const latestContacts=useRef<NostrEvent|null>(null);
 const reposting=useRef(false);
 const quoteRequest=useRef(0),quoteRetry=useRef<NostrEvent|null>(null);
 const loginSession=useRef(new LoginSession()),[loggingIn,setLoggingIn]=useState(false);
 const activeUser=useRef(''),selectedAuthor=useRef(''),profileSnapshots=useRef(new ProfileSnapshots((ws,frame)=>sendRelay(ws as WebSocket,frame))),profileOverflow=useRef(false);
 const generation=useRef(0),sockets=useRef<WebSocket[]>([]),timers=useRef(new Set<ReturnType<typeof setTimeout>>()),connection=useRef<RelayConnections|null>(null),publisher=useRef(new RelayPublisher());
 const quotes=useRef<QuoteResolver|null>(null);if(!quotes.current)quotes.current=new QuoteResolver(()=>sockets.current,()=>activeRelays.current.filter(r=>r.read).map(r=>r.url));
 const [repostNotes,setRepostNotes]=useState<Record<string,NostrEvent>>({});
 const visibleOriginals=useMemo(()=>followingActive?following.state.originals:repostNotes,[followingActive,following.state.originals,repostNotes]);
 const followingEvents=following.state.events;
 const receiveFollowingProfiles=useEffectEvent(()=>requestProfiles([...followingEvents,...Object.values(following.state.originals)]));
 useEffect(()=>{if(followingEvents.length)receiveFollowingProfiles()},[followingEvents,following.state.originals]);
 const reposts=useRef<TimelineReposts|null>(null);
 useEffect(()=>{for(const n of notes)if(n.kind===6)reposts.current?.add(n as NostrEvent)},[notes]);
 const resolveQuote=useMemo(()=>(id:string)=>quotes.current!.request(id),[relays]);
 function later(fn:()=>void,ms:number){const timer=setTimeout(()=>{timers.current.delete(timer);fn()},ms);timers.current.add(timer);return timer}
 const toastTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function notify(m:string){if(toastTimer.current){clearTimeout(toastTimer.current);timers.current.delete(toastTimer.current)}setToast(m);toastTimer.current=later(()=>setToast(''),4500)}
 const pendingFeed=useRef(new Map<string,Note>()),feedBatch=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),feedFull=useRef(false);feedFull.current=notes.length>=FEED_LIMIT;
 const profilePins=useRef(new Set<string>());profilePins.current=new Set([pubkey,profileKey,...notes.map(n=>n.pubkey),...followingEvents.map(n=>n.pubkey),...Object.values(following.state.originals).map(n=>n.pubkey),...Object.values(repostNotes).map(n=>n.pubkey),...authorNotes.map(n=>n.pubkey)]);
 function collectFeed(event:Note){if(feedFull.current)return;if(pendingFeed.current.size<FEED_LIMIT)pendingFeed.current.set(event.id,event);if(!feedBatch.current)feedBatch.current=later(()=>{feedBatch.current=undefined;const batch=[...pendingFeed.current.values()];pendingFeed.current.clear();setNotes(old=>retainFeed(old,batch));requestProfiles(batch)},80)}
 useEffect(()=>{if(notes.length>=FEED_LIMIT)for(const ws of sockets.current)if(ws.readyState===1&&canRead(activeRelays.current,ws.url))sendRelay(ws,JSON.stringify(['CLOSE','feed']))},[notes.length]);
 useEffect(()=>()=>{relayDiscovery.current.cancel();accountRelays.current?.stop();relayAccountAbort.current.abort()},[]);
 useEffect(()=>{relayDiscovery.current.cancel()},[pubkey]);
 useEffect(()=>{reposts.current=new TimelineReposts(id=>quotes.current!.request(id),(event,original)=>{setRepostNotes(old=>({...old,[event.id]:original}));requestProfiles([event,original])});let initial=DEFAULT_RELAYS;try{guestRelays.current=readGuestConnections(localStorage);initial=guestRelays.current??DEFAULT_RELAYS}catch{}setRelays(initial);void connect(initial);try{setBookmarks(JSON.parse(localStorage.getItem('petal-bookmarks')||'[]').filter((id:unknown)=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)));}catch{};try{setDark(localStorage.getItem('petal-dark')==='true')}catch{}setThemeReady(true);return()=>{loginSession.current.cancel();searchEpoch.current++;searcher.current.cancel();homePager.current.reset();authorPager.current.reset();generation.current++;initialFeed.current.cancel();reposts.current?.reset();quotes.current?.reset();profileSnapshots.current.stop();profileOverflow.current=false;connection.current?.stop();publisher.current.cancel();timers.current.forEach(clearTimeout)}},[]);

 useEffect(()=>{if(!themeReady)return;document.documentElement.dataset.theme=dark?'dark':'light';try{localStorage.setItem('petal-dark',String(dark))}catch{}},[dark,themeReady]);
 function save(id:string){setBookmarks(b=>{const n=b.includes(id)?b.filter(x=>x!==id):[...b,id];localStorage.setItem('petal-bookmarks',JSON.stringify(n));return n})}
 async function connect(config:RelayConfig[]=activeRelays.current,keepModal=false){
  relayDiscovery.current.cancel();pendingFeed.current.clear();if(feedBatch.current){clearTimeout(feedBatch.current);timers.current.delete(feedBatch.current);feedBatch.current=undefined}feedFull.current=false;cancelSearch();homePager.current.reset();authorPager.current.reset();authorCache.current.clear();setPaging({loading:false,error:'',done:false});const run=++generation.current;activeRelays.current=config;setTab('すべて');setAuthorNotes([]);setNotes([]);setRepostNotes({});reposts.current?.reset();quotes.current?.reset();profileSnapshots.current.stop();profileOverflow.current=false;connection.current?.stop();publisher.current.cancel();sockets.current=[];setStatuses(Object.fromEntries(config.map(r=>[r.url,r.read||r.write?'接続中':'無効'])));if(!keepModal)setModal('');
  initialFeed.current.start(config.filter(r=>r.read).map(r=>r.url),setInitialLoading);
  const {verifyEvent}=await import('nostr-tools');if(run!==generation.current)return;
  connection.current=new RelayConnections({
   status:(url,status)=>{if(run===generation.current){setStatuses(s=>({...s,[url]:status}));if(status==='接続失敗')initialFeed.current.settle(url)}},
   changed:current=>{if(run===generation.current)sockets.current=current},
   disconnected:url=>{if(run!==generation.current)return;relayDiscovery.current.disconnect(url);profileSnapshots.current.disconnect(url);quotes.current?.disconnect(url);searcher.current.disconnect(url);homePager.current.disconnect(url);authorPager.current.disconnect(url)},
   open:(ws,{url,read})=>{accountRelays.current?.reconnect(url);if(read){reposts.current?.retry();homePager.current.reconnect(url);authorPager.current.reconnect(url);setPaging(p=>({...p,done:false,error:''}));if(!feedFull.current)sendRelay(ws,JSON.stringify(['REQ','feed',{kinds:[1,6],limit:45}]));if(activeUser.current)sendRelay(ws,JSON.stringify(['REQ','contacts',{kinds:[3],authors:[activeUser.current],limit:1}]));if(selectedAuthor.current)sendRelay(ws,JSON.stringify(['REQ','author-notes',{kinds:[1],authors:[selectedAuthor.current],limit:60}]))}},
   message:(ws,{url,read},e,frame)=>{if(run!==generation.current)return;try{const m=frame as any[];if(m[1]==='feed'&&(m[0]==='EOSE'||m[0]==='CLOSED')){initialFeed.current.settle(url);return}if(String(m[1]).startsWith('relay-list-')){if(read)relayDiscovery.current.receive(url,m,m[0]==='EVENT'&&verifyEvent(m[2])?m[2]:undefined);return}if(String(m[1]).startsWith('quote-')){if(read)quotes.current?.receive(url,m);return;}if(String(m[1]).startsWith('search-')){if(m[0]==='EVENT'){if(read&&verifyEvent(m[2]))searcher.current.receive(url,m,m[2])}else searcher.current.receive(url,m);return}if(m[0]!=='EVENT'&&(homePager.current.receive(url,m)||authorPager.current.receive(url,m)))return;if(m[0]==='EOSE'&&m[1]==='author-notes'){setProfileLoading(false);sendRelay(ws,JSON.stringify(['CLOSE','author-notes']));return}if(m[0]!=='EVENT'&&profileSnapshots.current.receive(ws,m))return;if(m[0]==='OK'){publisher.current.receive(url,m[1],m[2]);return}if(m[0]!=='EVENT'||!read)return;const ev=m[2];if(!verifyEvent(ev))return;if(String(m[1]).startsWith('history-')){if(ev.kind===6||ev.kind===1&&ev.content.length<=10000){homePager.current.receive(url,m,ev);authorPager.current.receive(url,m,ev)}return}
    if(ev.kind===0){const p=readProfile(ev);if(p)setProfiles(old=>newerProfile(old[ev.pubkey],p)?retainProfiles(old,ev.pubkey,p,profilePins.current):old);return}
    if(ev.kind===3&&ev.pubkey===activeUser.current){const old=latestContacts.current;if(isLatestReplaceable(old,ev)){latestContacts.current=ev;setFollows([...new Set<string>(ev.tags.filter((t:string[])=>t[0]==='p'&&/^[a-f0-9]{64}$/.test(t[1])).map((t:string[])=>t[1]))])}return}
    if(ev.kind!==1&&ev.kind!==6||ev.kind===1&&ev.content.length>10000)return;
    if(m[1]==='author-notes'){if(ev.kind===1&&ev.pubkey===selectedAuthor.current){authorPager.current.observe(url,ev);setAuthorNotes(n=>retainFeed(n,[ev]));}return}
    if(m[1]==='feed'){homePager.current.observe(url,ev);collectFeed(ev);}
   }catch{}}
  });connection.current.start(config);
 }

 // Account settings and guest storage never share a configuration source.
 useLayoutEffect(()=>{if(!accountRelays.current)accountRelays.current=new AccountRelaySession(state=>accountRelayUpdate.current(state));accountRelayUpdate.current=state=>{if(state.owner!==activeUser.current)return;setAccountRelayState(state)}},[]);
 const applyAccountConnections=useEffectEvent(()=>{
  if(accountRelayState.owner!==activeUser.current)return;
  if(view!=='profile'||temporaryReaders.current.author!==profileKey)temporaryReaders.current={author:'',urls:[]};
  const base=activeUser.current?accountConnections(accountRelayState.event):guestRelays.current??DEFAULT_RELAYS;
  const config=withTemporaryReaders(base,temporaryReaders.current.urls);
  if(JSON.stringify(config)!==JSON.stringify(activeRelays.current)){setRelays(config);void connect(config,true)}
 });
 useEffect(()=>{if(!busy)applyAccountConnections()},[accountRelayState,busy,view,profileKey]);
 function switchRelayAccount(owner:string){
  relayAccountAbort.current.abort();relayAccountAbort.current=new AbortController();
  accountRelays.current?.stop();relayDiscovery.current.cancel();temporaryReaders.current={author:'',urls:[]};
  if(!owner)try{guestRelays.current=readGuestConnections(localStorage)}catch{}
  accountRelays.current!.start(owner,relayLookupUrls(null));
  const config=owner?accountConnections(accountRelays.current!.state.event):guestRelays.current??DEFAULT_RELAYS;
  setRelays(config);void connect(config,true);
 }
 function saveLocalRelays(config:RelayConfig[]){
  if(pubkey!==activeUser.current)throw Error('ログイン状態が変わりました');
  const saved=saveGuestConnections(localStorage,activeUser.current,config);
  guestRelays.current=saved;setRelays(saved);void connect(saved);
 }
 function readAuthorRelay(url:string){
  if(!pubkey||pubkey!==activeUser.current||view!=='profile'||profileKey!==selectedAuthor.current)throw Error('表示中のプロフィールが変わりました');
  const previous=temporaryReaders.current.author===profileKey?temporaryReaders.current.urls:[];
  const urls=[...new Set([...previous,url])];
  const config=withTemporaryReaders(accountConnections(accountRelays.current!.state.event),urls);
  temporaryReaders.current={author:profileKey,urls};setRelays(config);void connect(config);
 }
 async function loadOwnRelays(signal:AbortSignal){
  const owner=activeUser.current;if(!owner||owner!==pubkey)throw Error('ログインしてください');
  signal=AbortSignal.any([signal,relayAccountAbort.current.signal]);
  const known=accountRelays.current!.state.event;
  let urls=relayLookupUrls(known);
  let result=await loadAccountRelayList(owner,urls,signal);
  // A discovery relay may know an old list: follow its advertised locations before editing.
  for(let round=0;round<3;round++){
   const expanded=[...new Set([...urls,...relayLookupUrls(result.event)])];
   if(expanded.length===urls.length)break;
   if(expanded.length>48){result={...result,partial:true};break}
   urls=expanded;const next=await loadAccountRelayList(owner,urls,signal);
   const stale=!!result.event&&(!next.event||isLatestReplaceable(next.event,result.event));
   result={event:next.event&&isLatestReplaceable(result.event,next.event)?next.event:result.event,partial:result.partial||next.partial||stale};
   if(round===2)result={...result,partial:true};
  }
  if(activeUser.current!==owner)throw Error('ログイン状態が変わりました');
  const observed=accountRelays.current!.state.event;
  if(observed&&(!result.event||isLatestReplaceable(result.event,observed)))return {event:observed,partial:true};
  if(!signal.aborted)accountRelays.current!.observe(result);
  return result;
 }
 const relaySaving=useRef(false);
 async function saveOwnRelays(base:NostrEvent|null,rows:RelayConfig[],signal:AbortSignal){
  if(busy||relaySaving.current)throw Error('ほかの送信が完了してから保存してください');
  const owner=activeUser.current;if(!owner||owner!==pubkey)throw Error('ログインしてください');
  signal=AbortSignal.any([signal,relayAccountAbort.current.signal]);
  relaySaving.current=true;setBusy(true);
  try{
   const result=await saveAccountRelayList({owner,base,rows,signal,currentOwner:()=>activeUser.current,load:()=>loadOwnRelays(signal),sign:event=>{const extension=(window as Window&{nostr?:{signEvent:(event:EventTemplate)=>Promise<NostrEvent>}}).nostr;if(!extension)throw Error('署名拡張機能に接続してください');return extension.signEvent(event)},publish:event=>publishAccountRelayList(event,[...relayLookupUrls(base),...rows.map(r=>r.url)],signal)});
   if(!signal.aborted&&activeUser.current===owner&&result.confirmed)accountRelays.current!.accept(result.event);
   return result;
  }finally{relaySaving.current=false;setBusy(false)}
 }

 function sendRelay(ws:WebSocket,frame:string){return connection.current?.send(ws,frame)??false}

 function cancelSearch(){setNip05Query(null);searchEpoch.current++;searcher.current.cancel();setSearchChecking(false);setSearchResult(null)}
 useEffect(()=>{if(view!=='explore')cancelSearch()},[view]);
 async function runSearch(){const query=q.trim();if(!query||searchChecking||searcher.current.busy)return;cancelSearch();if(/^[^\s@]+@[^\s@]+$/.test(query)){setNip05Query({query,id:searchEpoch.current});return}const epoch=searchEpoch.current;setSearchChecking(true);const urls=activeRelays.current.filter(r=>r.read).map(r=>r.url);const support=Object.fromEntries(await Promise.all(urls.map(async url=>[url,await supportsSearch(url)])));if(epoch!==searchEpoch.current)return;setSearchChecking(false);
 const update=(result:SearchResult)=>{if(epoch!==searchEpoch.current||result.cancelled)return;setSearchResult(result);requestProfiles(result.events)};
 await searcher.current.start(sockets.current,urls,query,{support,onUpdate:update});
 }
 function navigate(next:string,record=true){navigationEpoch.current++;setFeedRestore(null);scrollRestore.current?.();pendingThread.current='';if(record)routeHistory.current?.push({view:next as 'home'});loginSession.current.cancelDestination();detailRequest.current++;setDetail(null);const same=view===next,epoch=navigationEpoch.current;setView(next);setQ('');setModal('');requestAnimationFrame(()=>{if(epoch===navigationEpoch.current)window.scrollTo({top:0,behavior:same&&next==='home'&&!lightweight&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'})})}
 function goHome(){navigate('home')}
 function openProfile(key:string,record=true){if(!/^[a-f0-9]{64}$/.test(key))return;navigationEpoch.current++;setFeedRestore(null);scrollRestore.current?.();pendingThread.current='';if(record)routeHistory.current?.push({view:'profile',id:key});loginSession.current.cancelDestination();setModal('');detailRequest.current++;setDetail(null);const sameAuthor=selectedAuthor.current===key;if(!sameAuthor){const cached=authorCache.current.get(key);authorCache.current.delete(key);if(selectedAuthor.current){authorCache.current.delete(selectedAuthor.current);authorCache.current.set(selectedAuthor.current,{notes:authorNotes,cursors:new Map([...authorPager.current.cursors].map(([url,cursor])=>[url,{...cursor}])),failed:new Set(authorPager.current.failed)});while(authorCache.current.size>2)authorCache.current.delete(authorCache.current.keys().next().value!)}authorPager.current.reset();if(cached){authorPager.current.cursors=new Map(cached.cursors);authorPager.current.failed=new Set(cached.failed)}setAuthorNotes(cached?.notes||notes.filter(n=>n.kind===1&&n.pubkey===key))}setPaging({loading:false,error:'',done:false});selectedAuthor.current=key;setProfileKey(key);setView('profile');setQ('');setProfileLoading(true);const reads=sockets.current.filter(s=>s.readyState===1&&canRead(activeRelays.current,s.url));for(const ws of reads){sendRelay(ws,JSON.stringify(['CLOSE','author-notes']));profileSnapshots.current.request(ws,key,true);sendRelay(ws,JSON.stringify(['REQ','author-notes',{kinds:[1],authors:[key],limit:60}]))}if(!reads.length)setProfileLoading(false);later(()=>{if(selectedAuthor.current===key)setProfileLoading(false)},8000);window.scrollTo({top:0,behavior:'instant'})}
 function requestProfiles(events:Pick<NostrEvent,'pubkey'>[],priority=false){for(const ws of sockets.current.filter(s=>s.readyState===1&&canRead(activeRelays.current,s.url)))for(const n of events){if(profileSnapshots.current.request(ws,n.pubkey,false,priority)==='overflow'&&!profileOverflow.current){profileOverflow.current=true;notify('プロフィール取得が混み合っています。プロフィールを開くと優先して再取得します')}}}

 function openDetail(n:Note,record=true,rowId=n.id){if(view==='thread'&&detail?.id===n.id)return;if(n.kind!==1||typeof n.sig!=='string'||!verifyEvent(n as NostrEvent))return;navigationEpoch.current++;setFeedRestore(null);scrollRestore.current?.();pendingThread.current='';routeEvents.current.set(n.id,n as NostrEvent);while(routeEvents.current.size>100)routeEvents.current.delete(routeEvents.current.keys().next().value!);if(record){const source=document.querySelector<HTMLElement>(`article[data-note-id="${rowId}"]`);routeHistory.current?.push({view:'thread',id:n.id},source?{id:rowId,offset:source.getBoundingClientRect().top}:undefined)}detailRequest.current++;setDetail(n as NostrEvent);setView('thread');setModal('');requestProfiles([n as NostrEvent]);const epoch=navigationEpoch.current;requestAnimationFrame(()=>{if(epoch===navigationEpoch.current)window.scrollTo({top:0,behavior:'instant'})})}
 async function loadReference(id:string){const token=++detailRequest.current;const result=await quotes.current!.request(id);if(token!==detailRequest.current||pendingThread.current!==id)return;if(result.event){routeEvents.current.set(id,result.event);while(routeEvents.current.size>100)routeEvents.current.delete(routeEvents.current.keys().next().value!);setDetail(result.event);pendingThread.current='';requestProfiles([result.event])}else setDetailError(result.error||'投稿が見つかりませんでした')}
 function openReference(id:string,record=true){if(!/^[a-f0-9]{64}$/.test(id))return;navigationEpoch.current++;setFeedRestore(null);scrollRestore.current?.();loginSession.current.cancelDestination();cancelSearch();if(record)routeHistory.current?.push({view:'thread',id});detailRequest.current++;setModal('');setView('thread');setDetailError('');const cached=routeEvents.current.get(id);setDetail(cached||null);pendingThread.current=cached?'':id;if(!cached){if(sockets.current.some(s=>s.readyState===1&&canRead(activeRelays.current,s.url)))void loadReference(id);else if(Object.keys(statuses).length&&!Object.values(statuses).some(s=>s==='接続中'))setDetailError('読み取りリレーに接続できていません。接続を確認して再試行してください')}if(record)window.scrollTo({top:0,behavior:'instant'})}
 function backDetail(){if(!routeHistory.current?.back())navigate('home')}
 function restoreScroll(y:number,anchor:ScrollAnchor|null){scrollRestore.current?.();let stopped=false;const token=navigationEpoch.current;let frame=0;const started=Date.now();let stableSince=0;const stop=()=>{stopped=true;cancelAnimationFrame(frame);window.removeEventListener('wheel',stop);window.removeEventListener('touchstart',stop);window.removeEventListener('keydown',stop)};const attempt=()=>{if(stopped||token!==navigationEpoch.current){stop();return}const node=anchor?document.querySelector<HTMLElement>(`article[data-note-id="${anchor.id}"]`):null;const target=node?window.scrollY+node.getBoundingClientRect().top-anchor!.offset:y;const drift=Math.abs(window.scrollY-target);window.scrollTo({top:target,behavior:'instant'});if((!anchor||node)&&drift<2){stableSince ||= Date.now()}else stableSince=0;if(stableSince&&Date.now()-stableSince>=350||Date.now()-started>8000){stop();return}frame=requestAnimationFrame(attempt)};window.addEventListener('wheel',stop,{passive:true});window.addEventListener('touchstart',stop,{passive:true});window.addEventListener('keydown',stop);scrollRestore.current=stop;frame=requestAnimationFrame(attempt)}
 routeApply.current=(route,y,anchor)=>{routeHistory.current?.mark();if(route.view==='profile')openProfile(route.id,false);else if(route.view==='thread')openReference(route.id,false);else navigate(route.view,false);setFeedRestore(anchor);restoreScroll(y,anchor)};
 useEffect(()=>{const history=new RouteHistory(window,(route,y,anchor)=>routeApply.current(route,y,anchor));routeHistory.current=history;const stop=history.start();return ()=>{stop();scrollRestore.current?.();routeHistory.current=null}},[]);
 useEffect(()=>{if(!pendingThread.current)return;if(sockets.current.some(s=>s.readyState===1&&canRead(activeRelays.current,s.url)))void loadReference(pendingThread.current);else if(Object.keys(statuses).length&& !Object.values(statuses).some(s=>s==='接続中'))setDetailError('読み取りリレーに接続できていません。接続を確認して再試行してください')},[statuses]);
 async function loadOlder(){if(followingActive){following.loadOlder();return}const isProfile=view==='profile';if((isProfile?profileLoading:initialFeed.current.loading)||view!=='home'&&!isProfile||paging.loading||paging.done||(isProfile?authorNotes:notes).length>=FEED_LIMIT)return;const key=screen.current,run=generation.current;const pager=isProfile?authorPager.current:homePager.current;if(pager.busy)return;const target=isProfile?profileKey:undefined;const readUrls=activeRelays.current.filter(r=>r.read).map(r=>r.url);if(!readUrls.length){setPaging({loading:false,error:'読み取りリレーに接続できていません',done:false});return;}setPaging({loading:true,error:'',done:false});try{const result=await pager.page(sockets.current,readUrls,target);if(!result||result.cancelled||run!==generation.current)return;if(isProfile){if(selectedAuthor.current===target)setAuthorNotes(n=>retainFeed(n,result.events))}else setNotes(n=>retainFeed(n,result.events));requestProfiles(result.events);if(screen.current===key)setPaging({loading:false,error:result.error,done:result.done,warning:result.warning})}catch{if(screen.current===key)setPaging({loading:false,error:'取得できませんでした。再試行してください',done:false})}}
 useEffect(()=>{setPaging({loading:false,error:'',done:false})},[view,profileKey]);
 useEffect(()=>{if(view==='home'&&initialLoading||view==='profile'&&localMutes.mutes.users.includes(profileKey)||(view==='profile'?authorNotes:notes).length>=FEED_LIMIT||!sockets.current.some(s=>s.readyState===1&&canRead(activeRelays.current,s.url))||profileLoading&&view==='profile'||!sentinel.current||paging.loading||paging.done||paging.error||q||view==='saved'||view==='explore'||view==='home'&&tab!=='すべて')return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void loadOlder()},{rootMargin:'240px'});observer.observe(sentinel.current);return()=>observer.disconnect()},[view,profileKey,tab,q,paging,notes.length,authorNotes.length,statuses,profileLoading,initialLoading,localMutes.mutes.users]);
 function applyLogin(result:LoginResult,automatic=false,keepModal=false){const k=result.key;
  if(activeUser.current!==k){latestContacts.current=null;setFollows([]);activeUser.current=k;switchRelayAccount(k)}activeUser.current=k;setPubkey(k);if((!automatic||result.destination)&&!keepModal)setModal('');
  if(!automatic)try{rememberLogin(window.localStorage,true)}catch{}
  sockets.current.filter(s=>s.readyState===1&&canRead(activeRelays.current,s.url)).forEach(s=>sendRelay(s,JSON.stringify(['REQ','contacts',{kinds:[3],authors:[k],limit:1}])));
  if(result.destination==='profile')openProfile(k);else if(result.destination==='notifications')navigate('notifications');
 }
 const restoredLogin=useRef<(result:LoginResult)=>void>(null!);restoredLogin.current=result=>applyLogin(result,true);
 useEffect(()=>{let alive=true;let storage:Storage;try{storage=window.localStorage;if(!rememberedLogin(storage))return}catch{return}const extension=(window as any).nostr;if(typeof extension?.getPublicKey!=='function')return;
  const session=loginSession.current;setLoggingIn(true);void restoreLogin(session,storage,extension).then(result=>{if(alive&&result)restoredLogin.current(result)}).finally(()=>{if(alive)setLoggingIn(session.pending)});
  return()=>{alive=false;session.cancel()};
 },[]);
 async function login(destination?:LoginDestination,keepModal=false,beforeDialog?:()=>void){
  const session=loginSession.current;
  if(destination)session.setDestination(destination);
  if(session.pending)return;
  if(activeUser.current){if(destination==='profile')openProfile(activeUser.current);else if(destination==='notifications')navigate('notifications');return}
  const extension=(window as any).nostr;
  if(typeof extension?.getPublicKey!=='function'){beforeDialog?.();setModal('login');return}
  setLoggingIn(true);
  try{const result=await session.login(()=>extension.getPublicKey(),destination);if(!result)return;applyLogin(result,false,keepModal);
  }catch{notify('ログインがキャンセルされたか、接続できませんでした')}finally{setLoggingIn(session.pending)}
 }
 function goTo(next:string){if(next==='profile'){if(activeUser.current)openProfile(activeUser.current);else void login('profile')}else if(next==='notifications'&&!activeUser.current)void login('notifications');else navigate(next)}

 async function publish(kind:number,content:string,tags:string[][],retry?:RefObject<NostrEvent|null>,signal?:AbortSignal){
  if(signal?.aborted)return false;
  if(!pubkey){await login();return false}
  const open=sockets.current.filter(s=>s.readyState===1&&canWrite(activeRelays.current,s.url));
  if(!open.length){notify('書き込み用のリレーに接続できていません');return false}
  setBusy(true);
  try{
   const {verifyEvent}=await import('nostr-tools');
   const publicationTags=kind===1?buildContentTags(content,tags):tags;
   // An unconfirmed quote may already exist on a relay. Retrying the same
   // account/content/tags reuses its signed id instead of creating a duplicate.
   const previous=retry?.current;
   const cached=previous&&previous.pubkey===pubkey&&previous.kind===kind&&previous.content===content&&JSON.stringify(previous.tags)===JSON.stringify(publicationTags)?previous:null;
   const unsigned={kind,content,tags:publicationTags,created_at:cached?.created_at??Math.floor(Date.now()/1000)};
   const expected=JSON.stringify(unsigned);
   const ev=cached??await (window as any).nostr.signEvent(unsigned);
   if(ev.pubkey!==pubkey||JSON.stringify({kind:ev.kind,content:ev.content,tags:ev.tags,created_at:ev.created_at})!==expected||!verifyEvent(ev))throw Error('署名を確認できませんでした');
   if(signal?.aborted)return false;
   if(activeUser.current!==pubkey)throw Error('ログイン状態が変わりました');
   if(retry)retry.current=ev;
   const targets=sockets.current.filter(s=>s.readyState===1&&canWrite(activeRelays.current,s.url));
   const result=await publisher.current.publish(targets,ev);
   if(!result.accepted){notify('受信確認が取れません。再投稿前にタイムラインを確認してください');return false}
   if(retry)retry.current=null;
   if(kind===1)setNotes(n=>retainFeed([ev],n));
   notify(result.unconfirmed?`${result.confirmed}/${result.total}リレーで投稿を確認。残りは未確認です`:'リレーが投稿を受け付けました');return true;
  }catch(e:any){if(!signal?.aborted)notify(e?.message||'署名または送信がキャンセルされました');return false}
  finally{setBusy(false)}
 }

 const posting=useRef(false);
 async function confirmRepost(note:Note,signal:AbortSignal,close:()=>void){
  if(busy||reposting.current||loggingIn||signal.aborted)return false;
  if(!activeUser.current){await login(undefined,true,close);return !activeUser.current}
  reposting.current=true;setBusy(true);const owner=activeUser.current;
  try{
   const source=await findRepostSource(note.id,activeRelays.current.filter(r=>r.read).map(r=>r.url));
   if(signal.aborted)return false;
   if(activeUser.current!==owner)throw Error('ログイン状態が変わりました');
   const data=repostPayload(source.event,source.relay);
   return await publish(6,data.content,data.tags,undefined,signal);
  }catch(e){if(!signal.aborted)notify(e instanceof Error?e.message:'リポスト元を確認できませんでした');return false}
  finally{reposting.current=false;setBusy(false)}
 }
 async function post(){if(!draft.trim()||busy||uploading||attachmentPending||posting.current)return;posting.current=true;try{if(await publish(1,draft,[])){composerDraft.accepted(draft);setReply(null)}}finally{posting.current=false}}
 const bookmarkSet=useMemo(()=>new Set(bookmarks),[bookmarks]);
 const likedSet=useMemo(()=>new Set(liked),[liked]);
 const replySet=useMemo(()=>new Set(openReplies),[openReplies]);
 const followSet=useMemo(()=>new Set(follows),[follows]);
 const searchProfiles=q?profiles:null;
 const filtered=useMemo(()=>{const query=q.toLowerCase();if(view==='explore')return (searchResult?.events||[]).filter(n=>!localMutes.isMuted(n));const source=view==='profile'?authorNotes:view==='saved'?[...new Map([...notes.filter(n=>n.kind===1),...Object.values(repostNotes)].map(n=>[n.id,n])).values()]:followingActive?followingEvents:notes;return source.filter(n=>{const original=n.kind===6?visibleOriginals[n.id]:n;return !!original&&!localMutes.isMuted(n)&&!localMutes.isMuted(original)&&(view!=='saved'||n.kind===1&&bookmarkSet.has(n.id))&&(view!=='home'||tab!=='フォロー中'||followSet.has(n.pubkey))&&(!query||original.content.toLowerCase().includes(query)||(searchProfiles?.[original.pubkey]?.name||'').toLowerCase().includes(query))})},[view,authorNotes,notes,repostNotes,visibleOriginals,followingActive,followingEvents,bookmarkSet,tab,followSet,q,searchProfiles,searchResult,localMutes.isMuted]);
 // Stable row props: events read the latest committed handlers, not captured
 // credentials or settings. Unrelated App updates do not rerender every note.
 const noteActions=useRef<NoteActions>(null!);
 useLayoutEffect(()=>{noteActions.current={
  profile:openProfile,save,openDetail:(n,rowId)=>openDetail(n,true,rowId),openReference,
  openReply:(n,rowId=n.id)=>{setOpenReplies(ids=>ids.includes(rowId)?ids:[...ids,rowId]);requestAnimationFrame(()=>document.getElementById('reply-'+rowId)?.focus({preventScroll:true}))},
  repost:confirmRepost,
  quote:async(n,signal,close)=>{
   if(busy||loggingIn||reposting.current||signal.aborted)return false;
   const request=++quoteRequest.current;
   if(!activeUser.current)await login(undefined,true,close);
   if(signal.aborted||request!==quoteRequest.current)return false;
   if(!activeUser.current)return true;
   // Restore the trigger before the dialog records its return-focus target.
   close();setReply(n);setModal('quote');return true;
  },
  like:async n=>{if(likedSet.has(n.id)){notify('すでにリアクション済みです。取り消しには未対応です');return}if(await publish(7,'+',[['e',n.id],['p',n.pubkey]]))setLiked(x=>x.includes(n.id)?x:[...x,n.id])},
  zap:n=>{if(!pubkey){void login();return}setZapNote(n)},
  share:n=>{void shareNote(n,{share:navigator.share?.bind(navigator),canShare:navigator.canShare?.bind(navigator),copy:text=>navigator.clipboard.writeText(text)}).then(result=>{if(result==='copied')notify('Nostrリンクをコピーしました')}).catch(()=>notify('シェアできませんでした'))},
  cancelReply:(n,rowId=n.id)=>{setOpenReplies(ids=>ids.filter(id=>id!==rowId));requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-reply-for="${rowId}"]`)?.focus())},
  send:async(n,text)=>{try{return await publish(1,text,makeReplyTags(n))}catch(error){notify(error instanceof Error?error.message:'返信先を確認できません');return false}}
 }});

 const openQuote=useMemo(()=>(n:NostrEvent)=>noteActions.current.openDetail(n),[]);
 const knownProfiles=useRef(profiles);knownProfiles.current=profiles;
 async function loadOwnProfile(signal:AbortSignal){const owner=activeUser.current;if(!owner||owner!==pubkey)throw Error('ログインしてください');const result=await loadEditableProfile(owner,activeRelays.current.filter(r=>r.read||r.write).map(r=>r.url),signal);if(activeUser.current!==owner)throw Error('ログイン状態が変わりました');const known=knownProfiles.current[owner];if(known&&(!result||result.event.created_at<known.created_at||result.event.created_at===known.created_at&&result.event.id>known.eventId))throw Error('既知のプロフィールより古い内容が返りました。接続を確認してください');return result}
 async function loadOwnFollows(signal:AbortSignal,allowPartial=false){const owner=activeUser.current;if(!owner||owner!==pubkey)throw Error('ログインしてください');const result=await loadFollowList(owner,activeRelays.current.filter(r=>r.read||r.write).map(r=>r.url),signal,{allowPartial,onEvent:allowPartial?event=>{if(!signal.aborted&&activeUser.current===owner&&isLatestReplaceable(latestContacts.current,event)){latestContacts.current=event;setFollows(followedKeys(event))}}:undefined});if(signal.aborted||activeUser.current!==owner)throw Error('ログイン状態が変わりました');const known=latestContacts.current;if(known&&known.pubkey===owner&&(!result||result.created_at<known.created_at||result.created_at===known.created_at&&result.id>known.id))throw Error('既知のフォローリストより古い内容が返りました。接続を確認してください');if(result){latestContacts.current=result;setFollows(followedKeys(result))}return result}
 const followSaving=useRef(false);
 async function changeFollow(base:NostrEvent|null,target:string,follow:boolean,signal:AbortSignal){if(busy||followSaving.current)throw Error('ほかの送信が終わってから操作してください');const owner=activeUser.current;if(!owner||owner!==pubkey)throw Error('ログインしてください');if(!sockets.current.some(s=>s.readyState===1&&canWrite(activeRelays.current,s.url)))throw Error('書き込み用リレーに接続できていません');followSaving.current=true;setBusy(true);try{const result=await saveFollowChange({owner,base,target,follow,signal,currentOwner:()=>activeUser.current,load:()=>loadOwnFollows(signal),sign:e=>(window as any).nostr.signEvent(e),publish:async e=>{const configured=activeRelays.current.filter(r=>r.write);const receipt=await publisher.current.publish(sockets.current.filter(s=>s.readyState===1&&canWrite(activeRelays.current,s.url)),e);return {confirmed:receipt.confirmed,total:configured.length}}});if(result.confirmed&&result.event&&activeUser.current===owner&&isLatestReplaceable(latestContacts.current,result.event)){latestContacts.current=result.event;setFollows(followedKeys(result.event))}return result}finally{followSaving.current=false;setBusy(false)}}
 const profileSaving=useRef(false);
 async function saveOwnProfile(base:EditableProfile|null,draft:ProfileDraft,signal:AbortSignal){if(busy||profileSaving.current)throw Error('ほかの送信が完了してから保存してください');const owner=activeUser.current;if(!owner||owner!==pubkey)throw Error('ログインしてください');if(!sockets.current.some(s=>s.readyState===1&&canWrite(activeRelays.current,s.url)))throw Error('書き込み用のリレーに接続できていません');profileSaving.current=true;setBusy(true);try{const result=await saveProfileEdit({owner,base,draft,signal,currentOwner:()=>activeUser.current,load:()=>loadOwnProfile(signal),sign:e=>(window as any).nostr.signEvent(e),publish:async e=>{const configured=activeRelays.current.filter(r=>r.write);const targets=sockets.current.filter(s=>s.readyState===1&&canWrite(activeRelays.current,s.url));const receipt=await publisher.current.publish(targets,e);return {confirmed:receipt.confirmed,total:configured.length}}});if(result.confirmed&&activeUser.current===owner){const profile=readProfile(result.profile.event);if(profile)setProfiles(old=>newerProfile(old[owner],profile)?retainProfiles(old,owner,profile,profilePins.current):old)}return result}finally{profileSaving.current=false;setBusy(false)}}
 const [lastModal,setLastModal]=useState('about');
 if(modal&&modal!==lastModal)setLastModal(modal);
 const relayEditor=useRef<RelayEditorHandle>(null);
 const [relayDiscovering,setRelayDiscovering]=useState(false);
 const displayModal=modal||lastModal;
 const online=Object.values(statuses).filter(x=>x==='接続済み').length;
 const enabledCount=relays.filter(r=>r.read||r.write).length;
 const connectionLabel=online?(online<enabledCount?`一部接続 ${online}/${enabledCount}`:'接続済み'):'未接続';
 const nav=[{id:'home',icon:Home,label:'ホーム'},{id:'explore',icon:Search,label:'みつける'},{id:'notifications',icon:Bell,label:'通知'},{id:'saved',icon:Bookmark,label:'ブックマーク'},{id:'profile',icon:UserRound,label:'プロフィール'}];
 const pageHeading=useRef<HTMLHeadingElement>(null),lastRoute=useRef('');
 useLayoutEffect(()=>{const route=[view,view==='profile'?profileKey:'',view==='thread'?detail?.id:''].join(':');if(lastRoute.current&&lastRoute.current!==route)pageHeading.current?.focus({preventScroll:true});lastRoute.current=route},[view,profileKey,detail?.id]);
 const mentionActions=useRef({request:(key:string)=>requestProfiles([{pubkey:key}],true),openProfile});
 mentionActions.current={request:(key:string)=>requestProfiles([{pubkey:key}],true),openProfile};
 const mentionContext=useMemo(()=>({profiles,request:(key:string)=>mentionActions.current.request(key),openProfile:(key:string)=>mentionActions.current.openProfile(key)}),[profiles]);
 return <MuteContext.Provider value={localMutes.isMuted}><DraftOwnerContext.Provider value={pubkey}><MentionContext.Provider value={mentionContext}><QuoteContext.Provider value={resolveQuote}><QuoteOpenContext.Provider value={openQuote}><M3eTheme color="#426427" scheme={dark?"dark":"light"} motion="expressive" strongFocus><a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus()}}>本文へ移動</a><div className="shell"><aside className="left"><a className="logo" href="#" onClick={e=>{e.preventDefault();goHome()}}><img className="brand-icon" src="/favicon.svg" width="32" height="32" alt=""/><span>nost.ing</span></a><M3eNavMenu onKeyDownCapture={e=>{if(!['Enter',' '].includes(e.key)||e.repeat||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;const menu=e.currentTarget;const target=e.target as HTMLElement;const item=target.closest?.('m3e-nav-menu-item')||document.getElementById(menu.getAttribute('aria-activedescendant')||'');const id=item?.getAttribute('data-nav-id');if(!id)return;e.preventDefault();e.stopPropagation();if(id==='settings')setModal('settings');else goTo(id)}}>{nav.map(({id,icon:Icon,label})=><M3eNavMenuItem key={id} data-nav-id={id} selected={view===id&&!modal}><Icon slot="icon" size={23}/><a slot="label" href={'#'+id} onClick={e=>{e.preventDefault();e.stopPropagation();goTo(id)}}>{label}</a></M3eNavMenuItem>)}<M3eNavMenuItem data-nav-id="settings" selected={!!modal}><SlidersHorizontal slot="icon" size={23}/><a slot="label" href="#settings" onClick={e=>{e.preventDefault();e.stopPropagation();setModal('settings')}}>設定</a></M3eNavMenuItem></M3eNavMenu><div className="left-bottom"><M3eButton className="about-button" onClick={()=>setModal('about')}><Link slot="icon" size={21}/><span>nost.ingについて</span></M3eButton></div></aside>
 <main id="main-content" tabIndex={-1} className={view==='thread'?'thread-view':undefined}><StickyHeader>{view==='thread'&&<M3eIconButton aria-label="戻る" onClick={backDetail}><ArrowLeft/></M3eIconButton>}{view==='profile'&&<M3eIconButton aria-label="戻る" onClick={backDetail}><ArrowLeft/></M3eIconButton>}<h1 ref={pageHeading} tabIndex={-1}>{view==='thread'?'投稿':view==='notifications'?'通知':view==='profile'?'プロフィール':view==='saved'?'ブックマーク':view==='explore'?'検索':'ホーム'}</h1><div className="header-actions"><M3eButton variant="text" onClick={()=>setModal('relays')} aria-label={`リレー接続状態: ${connectionLabel}`} title={connectionLabel}><span slot="icon" className="status-dot" style={{opacity:online?1:.35}}/><span className="petal-relay-full">{connectionLabel}</span><span className="petal-relay-compact" aria-hidden="true">{online}/{enabledCount}</span><ChevronDown className="relay-chevron" slot="trailing-icon" aria-hidden="true"/></M3eButton><M3eIconButton className="mobile-header-settings" aria-label="設定" onClick={()=>setModal('settings')}><Settings size={22}/></M3eIconButton><M3eButton className={"header-account-button"+(!pubkey?" login-entry":"")} variant="tonal" disabled={loggingIn} onClick={()=>pubkey?setModal('settings'):void login()}>{pubkey?'アカウント':loggingIn?'接続中':'ログイン'}</M3eButton></div></StickyHeader>
 {view==='home'&&<div className="feed-top"><M3eButtonGroup variant="connected" size="small" className="tabs" aria-label="タイムライン">{['すべて','フォロー中'].map(t=><M3eButton key={t} toggle selected={tab===t} aria-checked={tab===t?'true':'false'} tabIndex={tab===t?0:-1} onBeforeInput={e=>{if((e.target as HTMLElement & {selected:boolean}).selected)e.preventDefault()}} variant="tonal" className={tab===t?'selected':''} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const buttons=Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('m3e-button')||[]);const index=e.key==='Home'?0:e.key==='End'?buttons.length-1:(buttons.indexOf(e.currentTarget)+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();buttons[index]?.click()}} onChange={(e)=>{const button=e.target as HTMLElement & {selected:boolean};if(!button.selected){button.selected=true;return}setTab(t);if(t==='フォロー中'&&!pubkey)notify('フォローを読むにはログインしてください')}}><Check slot="selected-icon" aria-hidden="true"/><span>{t}</span></M3eButton>)}</M3eButtonGroup></div>}
 {view==='profile'&&<ProfileHeader key={profileKey} pubkey={profileKey} profile={profiles[profileKey]} action={<>{profileKey!==pubkey?<FollowButton owner={pubkey} target={profileKey} known={latestContacts.current?.pubkey===pubkey?latestContacts.current:null} load={signal=>loadOwnFollows(signal,true)} save={changeFollow} onLogin={()=>void login()} onMessage={notify}/>:null}<DropdownMenu modal={false}><DropdownMenuTrigger className="profile-menu-trigger" aria-label="プロフィールの操作"><MoreHorizontal aria-hidden="true"/></DropdownMenuTrigger><DropdownMenuContent className="profile-action-menu" portalContainer={typeof document!=='undefined'?document.querySelector('m3e-theme'):null} side="bottom" align="end" sideOffset={8}><DropdownMenuItem onSelect={()=>{void navigator.clipboard.writeText(window.location.origin+window.location.pathname+'#/profile/'+profileKey).then(()=>notify('プロフィールのURLをコピーしました')).catch(()=>notify('コピーできませんでした'))}}><Copy aria-hidden="true"/>URLをコピー</DropdownMenuItem><DropdownMenuItem onSelect={()=>setModal('author-relays')}><Radio aria-hidden="true"/>この人のリレー</DropdownMenuItem>{profileKey!==pubkey&&<DropdownMenuItem disabled={!localMutes.ready} onSelect={()=>{if(localMutes.mutes.users.includes(profileKey)){localMutes.removeUser(profileKey);notify('ミュートを解除しました')}else if(localMutes.addUser(profileKey))notify('このユーザーをミュートしました')}}><VolumeX aria-hidden="true"/>{localMutes.mutes.users.includes(profileKey)?'ミュート解除':'ミュート'}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></>} onEdit={pubkey&&profileKey===pubkey?()=>setModal('profile-edit'):undefined} onCopy={()=>{void navigator.clipboard.writeText(profileKey).then(()=>notify('公開鍵をコピーしました')).catch(()=>notify('コピーできませんでした'))}}/>}

 {view==='explore'&&<><form className="search main-search relay-search-form" onSubmit={e=>{e.preventDefault();void runSearch()}}><Search size={19}/><input aria-label="検索語" onKeyDown={e=>{if(e.key==='Enter'&&(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229))e.preventDefault()}} placeholder="投稿・NIP-05 を検索" maxLength={500} value={q} onChange={e=>{cancelSearch();setQ(e.target.value)}}/><M3eIconButton type="button" aria-label="検索を実行" disabled={!q.trim()||searchChecking||!!searchResult?.relays.some(r=>r.status==='loading')} onClick={()=>void runSearch()}><ArrowRight/></M3eIconButton></form>{nip05Query&&<Nip05Search key={pubkey+':'+nip05Query.id} identifier={nip05Query.query} relays={relays.filter(r=>r.read).map(r=>r.url)} onOpen={(key,profile)=>{setProfiles(old=>newerProfile(old[key],profile)?retainProfiles(old,key,profile,profilePins.current):old);openProfile(key)}}/>}<SearchStatus checking={searchChecking} result={searchResult} onSettings={()=>setModal('relays')}/></>}
 {view==='home'&&<section className="composer"><div className="compose-body"><textarea readOnly={uploading||busy} aria-label="投稿本文" id="composer" maxLength={4000} placeholder="いま、どんな気分？" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229&&!e.repeat){e.preventDefault();if(!busy)void post()}}}/>{!composerDraft.saved&&<p className="draft-status">このブラウザに保存できません。閉じる前にコピーしてください</p>}{draft&&<button type="button" className="draft-clear" disabled={busy||uploading} onClick={()=>setDraft('')}>下書きを消去</button>}<ImageUpload pubkey={pubkey} disabled={busy||draft.length>3500} onLogin={()=>void login()} onBusy={setUploading} onPending={setAttachmentPending} onUploaded={url=>setDraft(previous=>previous+(previous.trim()?'\n':'')+url)} action={<M3eButton variant="filled" size="medium" disabled={!draft.trim()||busy||uploading||attachmentPending} onClick={post}>{busy?'送信中…':'投稿'}<ArrowUpRight slot="trailing-icon" size={20}/></M3eButton>}/></div></section>}
 {view==='notifications'?<NotificationFeed isMuted={localMutes.isMuted} pubkey={pubkey} readRelays={inboxRelays} onLogin={()=>void login('notifications')} onProfile={openProfile} onOpen={openDetail} onEvents={requestProfiles} nameFor={key=>profiles[key]?.display_name||profiles[key]?.name||short(key)} renderNote={n=>localMutes.isMuted(n)?null:<NoteRow key={n.id} n={n} profile={profiles[n.pubkey]} replyOpen={replySet.has(n.id)} isLiked={likedSet.has(n.id)} isSaved={bookmarkSet.has(n.id)} busy={busy&&replySet.has(n.id)} actions={noteActions}/>}/>:view==='thread'&&!detail?<div className="empty" role="status">{detailError?<><p>{detailError}</p><M3eButton onClick={()=>{setDetailError('');if(pendingThread.current)void loadReference(pendingThread.current)}}>再試行</M3eButton><M3eButton onClick={()=>setModal('relays')}>接続を確認</M3eButton></>:<Loading/>}</div>:view==='thread'&&detail&&localMutes.isMuted(detail)?<div className="empty">ミュート設定によりこの投稿を非表示にしています。</div>:view==='thread'&&detail?<ThreadDetail key={detail.id} event={detail} readRelays={zapReadRelays} onBack={backDetail} onEvents={requestProfiles} renderNote={n=>localMutes.isMuted(n)?null:<NoteRow key={n.id} n={n} profile={profiles[n.pubkey]} replyOpen={replySet.has(n.id)} isLiked={likedSet.has(n.id)} isSaved={bookmarkSet.has(n.id)} busy={busy&&replySet.has(n.id)} actions={noteActions}/>}/>:<> <div className="feed"><MemoizedNoteList notes={filtered} originals={visibleOriginals} profiles={profiles} replySet={replySet} likedSet={likedSet} bookmarkSet={bookmarkSet} busy={busy} actions={noteActions} lightweight={lightweight&&(view==='home'||view==='profile')} restoreAnchor={feedRestore} onFallback={lightweightFallback}/>{view!=='explore'&&!filtered.length&&<div className="empty">{(view==='profile'?profileLoading:view==='home'&&(followingActive?following.state.loading:initialLoading))?(followingActive?null:<Loading/>):<h3>{view==='profile'?(localMutes.mutes.users.includes(profileKey)?'ミュート設定により投稿を非表示にしています':profileLoading?'投稿を読み込み中…':'このリレーで投稿は見つかりませんでした'):view==='saved'?'ブックマークはまだありません':q?'該当するノートがありません':tab==='フォロー中'?'フォロー中のノートはまだありません':Object.values(statuses).some(s=>s==='接続中')?'接続中…':!relays.some(r=>r.read)?'読み取り用のリレーを有効にしてください':online?'ノートを待っています':'リレーに接続できませんでした'}</h3>}{!online&&<M3eButton variant="filled" className="primary-action" onClick={()=>setModal('relays')}>接続を確認</M3eButton>}</div>}</div>{followingActive&&pubkey&&<FollowingHistory feed={following} auto={!q}/>}
 {(!followingActive&&view==='home'&&!initialLoading||view==='profile'&&!profileLoading&&!localMutes.mutes.users.includes(profileKey))&&<div ref={sentinel} className="history-loader" aria-live="polite">{paging.warning&&<span>{paging.warning}</span>}{(view==='profile'?authorNotes:notes).length>=FEED_LIMIT?<><p>読み込み済みの投稿が{FEED_LIMIT}件に達しました。現在の表示を保つため自動取得を一時停止しています。</p><M3eButton onClick={()=>{goHome();void connect()}}>表示を整理して最新から読み直す</M3eButton></>:paging.loading?<Loading/>:paging.error?<><p>{paging.error}</p><M3eButton variant="tonal" onClick={()=>{(view==='profile'?authorPager:homePager).current.retryFailures();setPaging({loading:false,error:'',done:false})}}>再試行</M3eButton></>:paging.done?<span>{paging.warning?'取得できたリレーの投稿を読み込みました':'これ以上の投稿はありません'}</span>:<M3eButton onClick={loadOlder}>過去の投稿を読み込む</M3eButton>}</div>}</>}</main>
 <M3eNavBar className="mobile-nav">{nav.map(({id,icon:Icon,label})=><M3eNavItem key={id} selected={view===id&&!modal} onClick={()=>{goTo(id)}} aria-label={label}><Icon slot="icon" size={24}/>{label}</M3eNavItem>)}</M3eNavBar>
 {zapNote&&<M3eDialog open dismissible closeLabel="閉じる" onClosed={()=>setZapNote(null)} aria-label="Zap"><X slot="close-icon"/><h2 slot="header">Zap</h2><ZapPanel event={{id:zapNote.id,pubkey:zapNote.pubkey,tags:zapNote.tags||[]}} profile={profiles[zapNote.pubkey]||{}} pubkey={pubkey} readRelays={zapReadRelays} signEvent={async unsigned=>{if(activeUser.current!==pubkey)throw Error('ログイン状態が変わりました');const event=await (window as any).nostr.signEvent(unsigned);if(activeUser.current!==pubkey)throw Error('ログイン状態が変わりました');return event}}/></M3eDialog>}
 {toast&&<div className="toast" role="status"><Check size={18}/>{toast}</div>}
 <M3eDialog className={displayModal==='quote'?'quote-dialog':undefined} open={!!modal} onOpened={event=>{if(modal==='quote'){const input=(event.target as HTMLElement).querySelector<HTMLTextAreaElement>('.quote-composer textarea');if(input)void focusWhenReady(input)}}} dismissible={!(modal==='quote'&&busy)} disableClose={modal==='quote'&&busy} closeLabel="閉じる" onClosing={event=>{if(modal==='quote'&&busy){event.preventDefault();return}quoteRequest.current++;if(modal==='relays')setModal('')}} onClosed={()=>{if(displayModal==='login')loginSession.current.cancelDestination();setModal('')}} aria-label={displayModal==='quote'?'引用投稿':'設定と接続'}><X slot="close-icon"/>{displayModal==='profile-edit'?<><h2 slot="header">プロフィールを編集</h2>{modal==='profile-edit'&&pubkey&&<ProfileEditor key={pubkey} load={loadOwnProfile} save={saveOwnProfile} onSaved={()=>{notify('プロフィールを保存しました');setModal('')}}/>}</>:displayModal==='login'?<><h2 slot="header">ログイン</h2><p>Nostr署名拡張機能（NIP-07）が見つかりません。対応ブラウザで開いてください。</p><M3eButton variant="filled" className="primary-action" disabled={loggingIn} onClick={()=>void login()}>もう一度確認</M3eButton></>:(displayModal==='relays'||displayModal==='author-relays')?<><div slot="header" className="relay-dialog-header"><h2>{displayModal==='author-relays'?'この人のリレー':'リレー'}</h2>{displayModal==='author-relays'&&<M3eIconButton aria-label={relayDiscovering?'リレーを取得中':'リレーを再取得'} disabled={busy||relayDiscovering} onClick={()=>relayEditor.current?.reload()}><RefreshCw aria-hidden="true"/></M3eIconButton>}</div>{modal===displayModal&&(displayModal==='relays'&&pubkey?<AccountRelayEditor key={pubkey} load={loadOwnRelays} save={saveOwnRelays}/>:<RelayEditor ref={relayEditor} onDiscoveringChange={setRelayDiscovering} key={displayModal+':'+(displayModal==='author-relays'?profileKey:pubkey)+':'+JSON.stringify(relays)} discoveryLabel={displayModal==='author-relays'?'この人':'自分'} discoveryPurpose={displayModal==='author-relays'?'author':'self'} onDiscover={displayModal==='author-relays'&&profileKey?signal=>relayDiscovery.current.start(sockets.current,activeRelays.current.filter(r=>r.read).map(r=>r.url),profileKey,signal):undefined} value={relays} statuses={statuses} busy={busy} onReconnect={url=>{connection.current?.restart(url)}} onSave={saveLocalRelays} onRead={pubkey&&displayModal==='author-relays'?readAuthorRelay:undefined}/>)}</>:displayModal==='settings'?<><h2 slot="header">設定</h2><M3eActionList><M3eListAction onClick={()=>setDark(!dark)}>{dark?<Moon slot="leading"/>:<Sun slot="leading"/>}<span>{dark?'ダークモード':'ライトモード'}</span></M3eListAction><M3eListAction onClick={()=>setModal('relays')}><Radio slot="leading"/><span>リレー接続</span><ArrowUpRight slot="trailing" aria-hidden="true"/></M3eListAction><M3eListAction onClick={()=>pubkey?openProfile(pubkey):void login()}><Link slot="leading"/><span>{pubkey?short(pubkey):'署名拡張機能に接続'}</span></M3eListAction><M3eListAction onClick={()=>setModal('about')}>nost.ingについて</M3eListAction>{(pubkey||loggingIn)&&<M3eListAction onClick={()=>{try{rememberLogin(window.localStorage,false)}catch{}loginSession.current.logout();setLoggingIn(false);activeUser.current='';switchRelayAccount('');setPubkey('');setFollows([]);notify('接続情報を解除しました')}}><LogOut slot="leading"/>{pubkey?'ログアウト':'接続を中止'}</M3eListAction>}</M3eActionList><section className="performance-settings"><label><input type="checkbox" checked={lightweight} onChange={e=>setLightweight(e.target.checked)}/>軽量表示（試験・このタブのみ）</label><p>ホームとプロフィールで画面外の投稿を省略します。ページ内検索や読み上げを使う場合はオフにしてください。Tab操作・画面幅の変更時には通常表示へ戻ります。</p></section><MuteSettings key={pubkey||'guest'} {...localMutes}/></>:displayModal==='quote'?<><h2 slot="header">引用</h2>{reply&&<QuoteComposer key={pubkey+':'+reply.id} source={reply} name={profiles[reply.pubkey]?.display_name||profiles[reply.pubkey]?.name||short(reply.pubkey)} busy={busy} onClose={()=>setModal('')} onSend={async text=>{const event=quotePost(reply,text);return publish(event.kind,event.content,event.tags,quoteRetry)}}/>}</>:<><h2 slot="header">nost.ingについて</h2><p>公開リレーに接続するNostrクライアントです。</p><p>UI：M3E（matraic、MITライセンス）のWeb Components。Google公式製ではありません。</p><p>対応：公開ノート、返信、リアクション、リポスト、ローカルブックマーク、NIP-07署名。画像・動画表示に対応。DM・リモート署名は未対応です。通知は設定したメンション受信先から取得します。</p><p>公開投稿は取り消せない場合があります。ブックマーク・テーマ・下書き・ミュートをこのブラウザに保存します。下書き・ミュートはアカウント別です。リレーの接続設定は未ログイン時のみこのブラウザに保存します。プロフィール画像・投稿画像は配信元から読み込み、動画は操作後に読み込みます。配信元にはIPアドレスが伝わります。</p></>}</M3eDialog>
 </div></M3eTheme></QuoteOpenContext.Provider></QuoteContext.Provider></MentionContext.Provider></DraftOwnerContext.Provider></MuteContext.Provider>
}
