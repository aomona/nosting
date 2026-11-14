import {createRoot} from 'react-dom/client';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import App from '../../components/petal-app';
import {RELAY_STORAGE} from '../../lib/relays';
import {matchesRelayFilter} from '../../lib/relay-connections';
import '../../app/globals.css';
// This fixture replaces every network/signer path before mounting the actual app.
const secret=generateSecretKey(),pubkey=getPublicKey(secret),now=Math.floor(Date.now()/1000);
const make=(kind,content,tags=[])=>finalizeEvent({kind,created_at:now-300,content,tags},secret);
const events=[make(0,JSON.stringify({name:'haru',display_name:'Haru',nip05:'haru@example.com',about:'週末の散歩と、日々のメモ。'})),make(10002,'',[['r','wss://mock.example']]),make(1,'今日は近所の公園を散歩しました。')];
secret.fill(0);
window.qa={pubkey,frames:[]};
localStorage.clear();
localStorage.setItem(RELAY_STORAGE,JSON.stringify([{url:'wss://mock.example',read:true,write:false}]));
window.nostr={getPublicKey:async()=>pubkey,signEvent:async()=>{throw Error('Signing disabled in app layout fixture')}};
window.fetch=async (url,options={})=>{
 if(String(url)==='https://example.com/.well-known/nostr.json?name=haru'){
  if(options.redirect!=='error'||options.credentials!=='omit')throw Error('Unsafe lookup');
  return Response.json({names:{haru:pubkey}});
 }
 if(options.headers?.Accept==='application/nostr+json')return Response.json({supported_nips:[50]});
 throw Error('External HTTP forbidden');
};
window.WebSocket=class {
 readyState=0;
 constructor(url){this.url=url;queueMicrotask(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.()})}
 send(raw){const frame=JSON.parse(raw);window.qa.frames.push(frame);if(frame[0]==='CLOSE')return;if(frame[0]!=='REQ')throw Error('Publication forbidden');queueMicrotask(()=>{if(this.readyState===3)return;for(const event of events.filter(event=>frame.slice(2).some(filter=>matchesRelayFilter(event,filter))))this.onmessage?.({data:JSON.stringify(['EVENT',frame[1],event])});this.onmessage?.({data:JSON.stringify(['EOSE',frame[1]])})})}
 close(){this.readyState=3}
};
location.hash='#/profile/'+pubkey;
createRoot(document.getElementById('root')).render(<App/>);
