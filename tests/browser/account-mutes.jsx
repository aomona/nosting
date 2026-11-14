import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import {finalizeEvent,generateSecretKey,getPublicKey,nip44} from 'nostr-tools';
import AccountMuteSettings from '../../components/account-mute-settings';
import MuteSettings from '../../components/mute-settings';
import {useAccountMutes} from '../../components/use-account-mutes';
import {useLocalMutes} from '../../components/use-local-mutes';
const key=generateSecretKey(),owner=getPublicKey(key),other=getPublicKey(generateSecretKey()),conversation=nip44.v2.utils.getConversationKey(key,owner);
let latest=finalizeEvent({kind:10000,created_at:Math.floor(Date.now()/1000)-20,tags:[['t','広告'],['e','b'.repeat(64)],['unknown','preserved']],content:nip44.v2.encrypt(JSON.stringify([['word','ネタバレ'],['t','spoiler'],['unknown','private']]),conversation)},key);
const qa=window.qa={sockets:[],frames:[],sent:[],fail:false,slow:false,signWait:false};
window.nostr={signEvent:async event=>{if(qa.signWait)await new Promise(resolve=>{qa.releaseSign=resolve});return finalizeEvent(event,key)},nip44:{encrypt:async(pub,text)=>nip44.v2.encrypt(text,conversation),decrypt:async(pub,text)=>nip44.v2.decrypt(text,conversation)}};
class Socket {
 readyState=0;
 constructor(url){this.url=url;qa.sockets.push(this);setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.()},5)}
 send(raw){const f=JSON.parse(raw);qa.frames.push(f);if(f[0]==='CLOSE')return;if(f[0]!=='REQ')throw Error('PUBLICATION FORBIDDEN');setTimeout(()=>{if(this.readyState===3)return;if(qa.fail&&this.url.includes('second')){this.onerror?.();return}if(f[2].authors.includes(owner))this.onmessage?.({data:JSON.stringify(['EVENT',f[1],latest])});this.onmessage?.({data:JSON.stringify(['EOSE',f[1]])})},qa.slow?500:10)}
 close(){this.readyState=3}
}
window.WebSocket=Socket;
function App(){
 const [account,setAccount]=useState(owner),[editor,setEditor]=useState(true),active=useRef(account);useLayoutEffect(()=>{active.current=account},[account]);
 const local=useLocalMutes(account),remote=useAccountMutes(account,['wss://first.example','wss://second.example'],()=>active.current,async event=>{qa.sent.push(event);latest=event;return {confirmed:1,total:2}});
 useEffect(()=>{qa.account=()=>setAccount(other);qa.close=()=>setEditor(false);qa.open=()=>setEditor(true);qa.reload=remote.reload;qa.ready=remote.ready;qa.filtered=remote.isMuted({kind:1,pubkey:other,content:'ネタバレ',tags:[]});qa.local=local.mutes},[remote,local]);
 return <M3eTheme color="#50633c"><main><h1>設定</h1>{editor&&<AccountMuteSettings key={account} {...remote}/>}<MuteSettings {...local}/></main></M3eTheme>;
}
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#fafbf3;color:#20251b}main{max-width:700px;margin:auto;padding:24px}h1{font-size:24px}';document.head.append(style);
createRoot(document.getElementById('root')).render(<App/>);
