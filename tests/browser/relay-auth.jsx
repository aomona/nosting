import {createRoot} from 'react-dom/client';
import {finalizeEvent,generateSecretKey,getPublicKey,verifyEvent} from 'nostr-tools';
import PetalApp from '../../components/petal-app';
import '../../app/globals.css';
// Full application with in-memory sockets and an ephemeral test-only signer.
const secret=generateSecretKey(),pubkey=getPublicKey(secret),now=Math.floor(Date.now()/1000);
const sign=event=>finalizeEvent(event,secret);
const relays=sign({kind:10002,created_at:now-10,content:'',tags:[['r','wss://auth.example/'],['r','wss://healthy.example/']]});
const note=sign({kind:1,created_at:now-5,content:'リレー認証のローカル検証',tags:[]});
const qa=window.qa={sent:[],signed:[],hold:false,release:null};
window.nostr={getPublicKey:async()=>pubkey,signEvent:async event=>{
 if(event.kind!==22242)throw Error('Only NIP-42 mock signing is allowed');
 qa.signed.push(event);
 if(qa.hold)await new Promise(resolve=>{qa.release=resolve;});
 return sign(event);
}};
class Socket {
 static OPEN=1;static CONNECTING=0;static CLOSED=3;
 readyState=0;authenticated=false;
 constructor(url){this.url=url;setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.({});if(url==='wss://auth.example/')this.reply(['AUTH','local-challenge']);},0);}
 reply(frame){queueMicrotask(()=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify(frame)});});}
 send(raw){const frame=JSON.parse(raw);qa.sent.push([this.url,frame]);
  if(frame[0]==='AUTH'){
   if(!verifyEvent(frame[1])||frame[1].kind!==22242||frame[1].tags[0][1]!==this.url||frame[1].tags[1][1]!=='local-challenge')throw Error('Bad mock AUTH');
   this.authenticated=true;this.reply(['OK',frame[1].id,true,'']);return;
  }
  if(frame[0]==='EVENT')throw Error('Publishing forbidden in browser QA');
  if(frame[0]!=='REQ')return;
  if(frame.slice(2).some(f=>f.kinds?.includes(10002))){this.reply(['EVENT',frame[1],relays]);this.reply(['EOSE',frame[1]]);return;}
  if(this.url==='wss://auth.example/'&&!this.authenticated){this.reply(['CLOSED',frame[1],'auth-required: local mock']);return;}
  if(frame.slice(2).some(f=>f.kinds?.includes(1)))this.reply(['EVENT',frame[1],note]);
  this.reply(['EOSE',frame[1]]);
 }
 close(){this.readyState=3;this.onclose?.({});}
 addEventListener(){}
 removeEventListener(){}
}
window.WebSocket=Socket;
localStorage.clear();
createRoot(document.getElementById('root')).render(<PetalApp/>);
