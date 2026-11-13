import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import NotificationFeed from '../../components/notification-feed';
const me=generateSecretKey(),other=generateSecretKey(),pub=getPublicKey(me),otherPub=getPublicKey(other),time=Math.floor(Date.now()/1000)-10;
const make=(i,t=time-i)=>finalizeEvent({kind:1,content:`ローカル通知 ${i} — 通知欄の履歴を表示しています。`,tags:[['p',pub]],created_at:t},other);
const events=Array.from({length:180},(_,i)=>make(i));
const qa=window.qa={events,requests:[],sockets:[],fail:false,slow:false,add(){const e=make('新着',Math.floor(Date.now()/1000));events.unshift(e);return e.id}};
class Socket{
 readyState=0;onopen=null;onmessage=null;onclose=null;onerror=null;
 constructor(url){this.url=url;qa.sockets.push(this);setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.()},20)}
 send(data){const frame=JSON.parse(data);qa.requests.push(frame);if(frame[0]==='CLOSE')return;if(frame[0]!=='REQ')throw Error('PUBLICATION FORBIDDEN');
  const [,id,f]=frame;setTimeout(()=>{if(this.readyState===3)return;if(qa.fail){this.onmessage?.({data:JSON.stringify(['CLOSED',id,'mock failure'])});return}
  const result=events.filter(e=>(!f['#p']||e.tags.some(t=>t[0]==='p'&&f['#p'].includes(t[1])))&&(!f.ids||f.ids.includes(e.id))&&(f.until===undefined||e.created_at<=f.until)&&(f.since===undefined||e.created_at>=f.since)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,f.limit);
  for(const e of result)this.onmessage?.({data:JSON.stringify(['EVENT',id,e])});this.onmessage?.({data:JSON.stringify(['EOSE',id])});
 },qa.slow?1500:50)}
 close(){this.readyState=3}
}
window.WebSocket=Socket;
function App(){const [account,setAccount]=useState(pub),[mounted,setMounted]=useState(true);useEffect(()=>{qa.account=()=>setAccount(v=>v===pub?otherPub:pub);qa.unmount=()=>setMounted(false)},[]);return <M3eTheme color="#50633c"><main><h1>通知</h1>{mounted&&<NotificationFeed pubkey={account} readRelays={['wss://qa.example']} onLogin={()=>{}} onProfile={()=>{}} onOpen={()=>{}} nameFor={()=>'テストユーザー'} isMuted={e=>e.content.includes('通知 4 ')} renderNote={e=><p className="fixture-note">{e.content}</p>}/>}</main></M3eTheme>}
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:var(--md-sys-color-surface,#fafbf3);color:var(--md-sys-color-on-surface,#20251b)}main{max-width:720px;margin:auto;padding:24px 0 80px}h1{padding:0 16px}.fixture-note{min-height:100px;padding:16px;margin:0;line-height:1.7}.petal-loading{padding:20px;display:flex;justify-content:center}';document.head.append(style);
createRoot(document.getElementById('root')).render(<App/>);
