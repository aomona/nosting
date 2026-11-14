import {useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import {ReactionsProvider} from '../../components/reactions';
import {NoteList} from '../../components/petal-app';
import {reactionTemplate} from '../../lib/reactions';
import '../../app/globals.css';
const secret=generateSecretKey(),owner=getPublicKey(secret);
const target=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1000),tags:[],content:'今日はいい天気。散歩に出かけよう。'},generateSecretKey());
const qa=window.qa={events:[finalizeEvent(reactionTemplate(target,{content:'+'}),secret)],sent:[],refuse:false,delay:false,signing:false};
const matches=(e,f)=>f.kinds.includes(e.kind)&&f.authors.includes(e.pubkey)&&(!f['#e']||e.tags.some(t=>t[0]==='e'&&f['#e'].includes(t[1])))&&(!f.since||e.created_at>=f.since);
const sockets=[];
window.WebSocket=class{
 readyState=0;
 constructor(url){this.url=url;this.queries=new Map();sockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.()},0)}
 send(raw){const f=JSON.parse(raw);if(f[0]==='CLOSE'){this.queries.delete(f[1]);return}if(f[0]!=='REQ')throw Error('Only mock REQ allowed');this.queries.set(f[1],f[2]);setTimeout(()=>{if(!this.queries.has(f[1]))return;for(const event of qa.events)if(matches(event,f[2]))this.onmessage?.({data:JSON.stringify(['EVENT',f[1],event])});this.onmessage?.({data:JSON.stringify(['EOSE',f[1]])})},5)}
 close(){this.readyState=3;this.queries.clear()}
};
function deliver(event){qa.events.push(event);for(const ws of sockets)if(ws.readyState===1)for(const [id,filter]of ws.queries)if(matches(event,filter))ws.onmessage?.({data:JSON.stringify(['EVENT',id,event])})}
qa.external=()=>deliver(finalizeEvent(reactionTemplate(target,{content:'👀'}),secret));
const relays=['wss://mock.invalid/'];
function Fixture(){const actions=useRef(Object.fromEntries(['openDetail','openReference','profile','openReply','repost','save','share','zap','cancelReply','send'].map(k=>[k,()=>{}])));const [account,setAccount]=useState(owner),[notice,setNotice]=useState('');return <M3eTheme color="#426427" scheme="light" motion="expressive"><main style={{maxWidth:640,margin:'40px auto',padding:0}}><h1 style={{fontSize:26}}>nost.ing</h1><ReactionsProvider owner={account} relays={relays} actions={{currentOwner:()=>account,login:()=>{},notify:setNotice,sign:async e=>{qa.signing=true;if(qa.delay)await new Promise(resolve=>{qa.resolve=resolve});qa.signing=false;if(qa.refuse)throw Error('署名をキャンセルしました');return finalizeEvent(e,secret)},publish:async e=>{qa.sent.push(e);deliver(e);return {confirmed:1,total:2}}}}><div className="feed"><NoteList notes={[target]} originals={{}} profiles={{[target.pubkey]:{name:'sakura',display_name:'さくら'}}} replySet={new Set()} bookmarkSet={new Set()} busy={false} actions={actions}/></div></ReactionsProvider><p role="status">{notice}</p><button id="account-switch" onClick={()=>setAccount(getPublicKey(generateSecretKey()))}>テスト用アカウント切替</button></main></M3eTheme>}
createRoot(document.getElementById('root')).render(<Fixture/>);
