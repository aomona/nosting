import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import {M3eButton} from '@m3e/react/button';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import ProfileHeader from '../../components/profile-header';
import ProfileEditor from '../../components/profile-editor';
import Nip05Search from '../../components/nip05-search';
import Nip05Identifier from '../../components/nip05-identifier';
import {readProfile} from '../../lib/profiles';
import {parseEditableProfile,buildProfileEdit} from '../../lib/profile-edit';
const secret=generateSecretKey(),pubkey=getPublicKey(secret);
const identifier=new URLSearchParams(location.search).has('long')?'haru'.repeat(50)+'@example.com':'haru@example.com';
let event=finalizeEvent({kind:0,created_at:Math.floor(Date.now()/1000)-100,content:JSON.stringify({name:'haru',display_name:'Haru',nip05:identifier,about:'週末の散歩と、日々のメモ。',custom:{keep:true}}),tags:[]},secret);
window.qa={opened:'',frames:[],saved:null};
window.fetch=async (url,{signal,redirect,credentials})=>{
 if(!String(url).startsWith('https://example.com/.well-known/nostr.json?name='))throw Error('External HTTP forbidden');
 if(redirect!=='error'||credentials!=='omit')throw Error('Unsafe lookup');
 const name=new URL(url).searchParams.get('name');
 if(name==='offline')throw Error('Mock offline');
 if(name==='slow')await new Promise(resolve=>setTimeout(resolve,200));
 if(signal.aborted)throw Error('aborted');
 return Response.json({names:{[name]:name==='mismatch'?'b'.repeat(64):pubkey}});
};
window.WebSocket=class {
 readyState=0;
 constructor(url){if(url!=='wss://mock.example')throw Error('External relay forbidden');queueMicrotask(()=>{this.readyState=1;this.onopen?.()})}
 send(raw){const frame=JSON.parse(raw);window.qa.frames.push(frame);if(frame[0]!=='REQ')return;queueMicrotask(()=>{this.onmessage?.({data:JSON.stringify(['EVENT',frame[1],event])});this.onmessage?.({data:JSON.stringify(['EOSE',frame[1]])})})}
 close(){this.readyState=3}
};
function App(){
 const [editing,setEditing]=useState(false),[profile,setProfile]=useState(readProfile(event)),[search,setSearch]=useState(false),[address,setAddress]=useState('slow@example.com');
 return <M3eTheme color="#50633c"><main><h1>{editing?'プロフィールを編集':'プロフィール'}</h1>{editing?<ProfileEditor load={async()=>parseEditableProfile(event,pubkey)} save={async(base,draft)=>{const template=buildProfileEdit(base,parseEditableProfile(event,pubkey),draft);event=finalizeEvent(template,secret);window.qa.saved=JSON.parse(event.content);setProfile(readProfile(event));return {confirmed:1,total:1,profile:parseEditableProfile(event,pubkey)}}} onSaved={()=>setEditing(false)}/>:<><ProfileHeader pubkey={pubkey} profile={profile} onEdit={()=>setEditing(true)} onCopy={()=>{}}/><section className="qa-search"><h2>みつける</h2><M3eButton onClick={()=>setSearch(true)}>haru@example.com を検索</M3eButton>{search&&<Nip05Search identifier="haru@example.com" relays={['wss://mock.example','wss://failed.example']} onOpen={key=>{window.qa.opened=key}}/>}</section><details><summary>検証用の未確認状態</summary><Nip05Identifier identifier="offline@example.com" pubkey={pubkey}/><Nip05Identifier identifier="mismatch@example.com" pubkey={pubkey}/><Nip05Identifier identifier={address} pubkey={pubkey}/><button onClick={()=>setAddress('offline@example.com')}>キャンセル検証</button></details></>}</main></M3eTheme>
}
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f7f9f0;color:#20251b;--surface:#edf0e6;--muted:#62685b;--ink:#20251b;--line:#dce1d3}main{max-width:680px;margin:36px auto;padding:20px}h1{font-size:28px;margin:0 0 24px}h2{font-size:20px}.qa-search{margin-top:32px}details{margin-top:40px;font-size:14px}button{font:inherit}.nip05-search{padding-top:16px}@media(max-width:500px){main{margin:0;padding:16px}}';document.head.append(style);
createRoot(document.getElementById('root')).render(<App/>);
