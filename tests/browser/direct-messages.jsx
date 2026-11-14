import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import {finalizeEvent,generateSecretKey,getPublicKey,getEventHash,nip44} from 'nostr-tools';
import DirectMessages from '../../components/direct-messages';
import {createRumor,wrapDm} from '../../lib/direct-messages';
const alice=generateSecretKey(),bob=generateSecretKey(),other=generateSecretKey();
const owner=getPublicKey(alice),peer=getPublicKey(bob);
const signer=key=>({getPublicKey:async()=>getPublicKey(key),signEvent:async e=>finalizeEvent(e,key),nip44:{encrypt:async(p,t)=>nip44.v2.encrypt(t,nip44.v2.utils.getConversationKey(key,p)),decrypt:async(p,t)=>nip44.v2.decrypt(t,nip44.v2.utils.getConversationKey(key,p))}});
window.nostr=signer(alice);
const qa=window.qa={owner,peer,sent:[],hold:false,rejectRecipient:false};
const now=Math.floor(Date.now()/1000);
const incoming=createRumor(peer,owner,'こんにちは。明日の読書会は14時からでどうでしょう？');
incoming.created_at=now-120;incoming.id=getEventHash(incoming);
const incomingWrap=await wrapDm(incoming,owner,signer(bob),new AbortController().signal);
const directory=[finalizeEvent({kind:10050,created_at:now,content:'',tags:[['relay','wss://alice.example/']]},alice),finalizeEvent({kind:10050,created_at:now,content:'',tags:[['relay','wss://bob.example/']]},bob)];
window.WebSocket=class{
 readyState=0;
 constructor(url){if(!['wss://alice.example/','wss://bob.example/','wss://directory.example/','wss://yabu.me/'].includes(url))throw Error('External relay forbidden');this.url=url;queueMicrotask(()=>{this.readyState=1;this.onopen?.()})}
 send(raw){const m=JSON.parse(raw);qa.sent.push({url:this.url,kind:m[0],eventId:m[0]==='EVENT'?m[1].id:undefined,eventKind:m[0]==='EVENT'?m[1].kind:undefined});if(qa.hold)return;queueMicrotask(()=>{
  if(this.readyState!==1)return;
  if(m[0]==='REQ'){for(const e of m[2].kinds?.includes(10050)?directory:m[2].kinds?.includes(1059)?[incomingWrap]:[])this.onmessage?.({data:JSON.stringify(['EVENT',m[1],e])});this.onmessage?.({data:JSON.stringify(['EOSE',m[1]])})}
  if(m[0]==='EVENT')this.onmessage?.({data:JSON.stringify(['OK',m[1].id,!(qa.rejectRecipient&&this.url==='wss://bob.example/'),'mock'])});
 })}
 close(){this.readyState=3}
};
function App(){const [key,setKey]=useState(owner);qa.switchAccount=()=>{window.nostr=signer(other);setKey(getPublicKey(other))};return <M3eTheme color="#426427"><main><header><span>nost.ing</span><h1>DM</h1></header><DirectMessages owner={key} lookup={['wss://directory.example/']} onLogin={()=>{}}/></main></M3eTheme>}
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;background:#f7f9f0;color:#20251b;font-family:Arial,sans-serif;--surface:#edf0e6;--border:#d5dbce;--primary-container:#d5e9bd}main{max-width:640px;margin:28px auto;background:#fffef8;border-radius:24px;overflow:hidden}header{padding:22px 20px 0}header span{color:#426427;font-size:17px;font-weight:600}h1{font-size:26px;margin:16px 0 4px}@media(max-width:640px){main{margin:0;border-radius:0;min-height:100vh}}';if(!new URLSearchParams(location.search).has('full'))document.head.append(style);
if(new URLSearchParams(location.search).has('full')){localStorage.setItem('petal-login-remember','1');localStorage.setItem('petal-dark',String(new URLSearchParams(location.search).get('theme')==='dark'));location.hash='#/messages';await import('../../app/globals.css');const FullApp=(await import('../../components/petal-app')).default;createRoot(document.getElementById('root')).render(<FullApp/>)}else createRoot(document.getElementById('root')).render(<App/>);
