import {createRoot} from 'react-dom/client';
import {finalizeEvent,generateSecretKey,getPublicKey,verifyEvent} from 'nostr-tools';
import App from '../../components/petal-app';
import {matchesRelayFilter} from '../../lib/relay-connections';
import '../../app/globals.css';

// Generated local identities only. Replace every WebSocket before mounting App.
const secret=generateSecretKey(),author=generateSecretKey(),pubkey=getPublicKey(secret);
const now=Math.floor(Date.now()/1000);
const source=finalizeEvent({kind:1,content:'小さな発見を、みんなで。\n\nA synthetic source note for quote testing.',tags:[],created_at:now-10},author);
const list=finalizeEvent({kind:10002,content:'',tags:[['r','wss://write.example','write'],['r','wss://read.example','read']],created_at:now-20},secret);
const profile=finalizeEvent({kind:0,content:JSON.stringify({name:'fixture',display_name:'ひなた'}),tags:[],created_at:now-20},author);
const qa=window.qa={source,pubkey,signed:[],published:[],mode:'success',events:[source,list,profile]};
window.nostr={getPublicKey:async()=>{if(qa.loginHold)await new Promise(resolve=>qa.loginRelease=resolve);return pubkey},signEvent:async event=>{
 qa.signed.push(event);
 if(qa.mode==='cancel')throw Error('署名がキャンセルされました');
 if(qa.mode==='hold')await new Promise(resolve=>qa.release=resolve);
 return finalizeEvent(event,secret);
}};
window.WebSocket=class {
 static OPEN=1;readyState=0;
 constructor(url){this.url=new URL(url).href;setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.()},0)}
 receive(frame){setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify(frame)})},0)}
 send(raw){const frame=JSON.parse(raw);
  if(frame[0]==='REQ'){
   for(const event of qa.events)if(frame.slice(2).some(filter=>matchesRelayFilter(event,filter)))this.receive(['EVENT',frame[1],event]);
   this.receive(['EOSE',frame[1]]);
  }else if(frame[0]==='EVENT'){
   const event=frame[1];if(!verifyEvent(event))throw Error('Invalid test signature');
   // Count quote publications separately from the NIP-65 list shared alongside them.
   if(event.kind===1)qa.published.push({url:this.url,event});
   if(qa.mode==='timeout')return;
   const accepted=qa.mode!=='reject';if(accepted)qa.events.push(event);
   this.receive(['OK',event.id,accepted,accepted?'':'blocked: fixture rejection']);
  }
 }
 close(){this.readyState=3}
};
createRoot(document.getElementById('root')).render(<App/>);
