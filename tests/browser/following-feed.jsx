import {createRoot} from 'react-dom/client';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import {matchesRelayFilter} from '../../lib/relay-connections';
import App from '../../components/petal-app';
import '../../app/globals.css';
const me=generateSecretKey(),friend=generateSecretKey(),other=generateSecretKey();
const owner=getPublicKey(me),author=getPublicKey(friend),time=Math.floor(Date.now()/1000)-10;
const make=(key,data)=>JSON.parse(JSON.stringify(finalizeEvent({kind:1,tags:[],content:'',created_at:time,...data},key)));
const seed='wss://yabu.me/',outbox='wss://following.example/',bad='wss://offline.example/';
const contacts=make(me,{kind:3,tags:[['p',author]]});
const ownRelays=make(me,{kind:10002,tags:[['r',seed]]});
const friendRelays=make(friend,{kind:10002,tags:[['r',outbox,'write'],['r',bad,'write']]});
const profiles=[make(me,{kind:0,content:JSON.stringify({name:'local-account',display_name:'ローカル確認用'})}),make(friend,{kind:0,content:JSON.stringify({name:'local-friend',display_name:'フォロー相手（モック）'})}),make(other,{kind:0,content:JSON.stringify({name:'local-other',display_name:'別の投稿者（モック）'})})];
const global=Array.from({length:60},(_,i)=>make(other,{created_at:time-i,content:`全体の投稿 ${i+1}`}));
const older=Array.from({length:125},(_,i)=>make(friend,{created_at:time-86400-i,content:`フォロー相手の古い投稿 ${i+1}\n全体フィードの取得範囲外から読み込んだモック投稿です。`}));
const original=make(other,{created_at:time-90000,content:'別の投稿者によるリポスト元（モック）'});
const repost=make(friend,{kind:6,created_at:time-86400+1,content:JSON.stringify(original),tags:[['e',original.id,outbox],['p',original.pubkey]]});
const qa=window.qa={requests:[],sockets:[],loginKey:owner,otherOwner:getPublicKey(other),fail:true,slow:false,contacts,owner,author,unfollow(){this.contacts=make(me,{kind:3,created_at:time+1});this.deliverContacts()},follow(){this.contacts=make(me,{kind:3,created_at:time+2,tags:[['p',author]]});this.deliverContacts()},deliverContacts(){for(const socket of this.sockets)for(const [id,f]of socket.subs)if(f.kinds?.includes(3))socket.deliver(['EVENT',id,this.contacts])},unmount(){root.unmount()}};
class Socket{
 static OPEN=1;readyState=0;onopen=null;onmessage=null;onclose=null;onerror=null;subs=new Map();
 constructor(url){this.url=url;qa.sockets.push(this);setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.()},10)}
 send(data){const frame=JSON.parse(data);qa.requests.push({url:this.url,frame});if(frame[0]==='CLOSE'){this.subs.delete(frame[1]);return}if(frame[0]!=='REQ')throw Error('PUBLICATION FORBIDDEN');const [,id,f]=frame;this.subs.set(id,f);
  setTimeout(()=>{if(this.readyState===3||!this.subs.has(id))return;if(this.url===bad&&qa.fail){this.deliver(['CLOSED',id,'mock failure']);return}
   const data=this.url===outbox?[...older,repost,original,...profiles]:this.url===bad?[]:[qa.contacts,ownRelays,friendRelays,...profiles,...global];
   const result=data.filter(e=>matchesRelayFilter(e,f)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,f.limit??100);
   for(const event of result)this.deliver(['EVENT',id,event]);this.deliver(['EOSE',id]);
  },qa.slow?1000:30);
 }
 deliver(frame){this.onmessage?.({data:JSON.stringify(frame)})}
 close(){this.readyState=3;this.subs.clear()}
}
window.WebSocket=Socket;
window.nostr={getPublicKey:async()=>qa.loginKey,signEvent:async()=>{throw Error('SIGNING FORBIDDEN')}};
const root=createRoot(document.getElementById('root'));root.render(<App/>);
