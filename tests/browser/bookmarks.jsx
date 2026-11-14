import {createRoot} from 'react-dom/client';
import {finalizeEvent, generateSecretKey, getPublicKey} from 'nostr-tools';
import App from '../../components/petal-app';
import '../../app/globals.css';
// Ephemeral test keys stay inside this module. No signer is exposed.
function fixtures() {
 const sk=generateSecretKey(),other=generateSecretKey(),owner=getPublicKey(sk),otherOwner=getPublicKey(other),time=Math.floor(Date.now()/1000)-100;
 const make=(kind,content,tags=[],created_at=time)=>finalizeEvent({kind,content,tags,created_at},sk);
 const note=make(1,'以前に保存した投稿。タイムラインになくても、IDから読み込めます。'),deleted=make(1,'削除対象のテスト投稿'),remote=make(1,'別クライアントで保存した投稿。'),missing='a'.repeat(64);
 const list=make(10003,'opaque fixture ciphertext',[['e',remote.id],['custom','keep']]);
 const mute=new URLSearchParams(location.search).has('muted')?[make(10000,'',[['e',remote.id]])]:[];
 const events=[...mute,note,deleted,remote,make(5,'',[['e',deleted.id]]),list,make(0,JSON.stringify({name:'mock-user',display_name:'テストユーザー'})),make(10002,'',[['r','wss://a.example'],['r','wss://b.example']])];
 return {owner,otherOwner,note,deleted,remote,missing,list,events,next:make(10003,'',[['e',note.id]],time+1)};
}
const fixture=JSON.parse(sessionStorage.getItem('bookmark-qa-fixtures')||'null')||fixtures();
sessionStorage.setItem('bookmark-qa-fixtures',JSON.stringify(fixture));
const {owner,otherOwner,note,deleted,remote,missing,events,next}=fixture;
const qa=window.qa={requests:[],sockets:[],fail:false,slow:false,owner,otherOwner,noteId:note.id,remoteId:remote.id,guestIds:[note.id,deleted.id,missing],account:owner,update(){events.splice(events.findIndex(e=>e.kind===10003),1,next);}};
if(!sessionStorage.getItem('bookmark-qa-seeded')){localStorage.clear();localStorage.setItem('petal-bookmarks',JSON.stringify(qa.guestIds));localStorage.setItem('petal-relays-v1',JSON.stringify([{url:'wss://a.example',read:true,write:false},{url:'wss://b.example',read:true,write:false}]));sessionStorage.setItem('bookmark-qa-seeded','1');}
window.nostr={getPublicKey:async()=>qa.account,signEvent:async()=>{throw Error('SIGNING FORBIDDEN');}};
class Socket {
 readyState=0;
 constructor(url){this.url=url;qa.sockets.push(this);setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.();},10);}
 send(raw){const frame=JSON.parse(raw);qa.requests.push(frame);if(frame[0]==='CLOSE')return;if(frame[0]!=='REQ')throw Error('PUBLICATION FORBIDDEN');
  const [,id,...filters]=frame;
  setTimeout(()=>{if(this.readyState===3)return;if(qa.fail&&this.url.includes('b.example')){this.onerror?.();return;}
   // Deliberately exclude saved notes from the ordinary timeline.
   const result=events.filter(e=>filters.some(f=>(e.kind!==1||f.ids)&&(!f.kinds||f.kinds.includes(e.kind))&&(!f.authors||f.authors.includes(e.pubkey))&&(!f.ids||f.ids.includes(e.id))&&(!f['#e']||e.tags.some(t=>t[0]==='e'&&f['#e'].includes(t[1])))));
   for(const e of result)this.onmessage?.({data:JSON.stringify(['EVENT',id,e])});this.onmessage?.({data:JSON.stringify(['EOSE',id])});
  },qa.slow?1500:30);
 }
 close(){this.readyState=3;}
}
window.WebSocket=Socket;
const root=createRoot(document.getElementById('root'));qa.unmount=()=>root.unmount();root.render(<App/>);
