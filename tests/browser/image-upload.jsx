import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import {M3eButton} from '@m3e/react/button';
import {finalizeEvent,generateSecretKey,getPublicKey,verifyEvent} from 'nostr-tools';
import ImageUpload from '../../components/image-upload';
// Ephemeral local signer; never connect a real extension or any relay.
const secret=generateSecretKey(),pubkey=getPublicKey(secret);
window.nostr={signEvent:async event=>finalizeEvent(event,secret)};
window.WebSocket=class{constructor(){throw Error('Relay connections forbidden')}};
const qa=window.qa={requests:[],error:'',status:413};
window.fetch=async (url,options)=>{
 if(url!==location.origin+'/api/uploads')throw Error('Unexpected request');
 const event=JSON.parse(atob(options.headers.Authorization.slice(6)));
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',options.body))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(!verifyEvent(event)||event.kind!==27235||event.tags.find(t=>t[0]==='payload')?.[1]!==hash)throw Error('Invalid fixture signature');
 qa.requests.push({type:options.headers['Content-Type'],hash,size:options.body.byteLength});
 return Response.json(qa.error?{error:qa.error}:{url:location.origin+'/api/media/local-fixture.jpg'},{status:qa.error?qa.status:201});
};
function App(){const [uploaded,setUploaded]=useState('');return <M3eTheme color="#50633c"><main><h1>投稿</h1><textarea aria-label="投稿内容" placeholder="いま、どうしてる？"/><ImageUpload pubkey={pubkey} onUploaded={setUploaded} onLogin={()=>{throw Error('Unexpected login')}} onBusy={()=>{}} onPending={()=>{}} action={<M3eButton variant="filled" disabled>投稿</M3eButton>}/>{uploaded&&<p role="status">ローカル検証完了</p>}</main></M3eTheme>}
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f7f9f0;color:#20251b;--surface:#edf0e6}main{max-width:620px;margin:48px auto;padding:24px}h1{font-size:24px}textarea{width:100%;height:140px;border:0;border-radius:16px;padding:16px;font:inherit;background:#edf0e6;resize:none}.composer-footer{display:flex;align-items:center;justify-content:space-between}';document.head.append(style);
createRoot(document.getElementById('root')).render(<App/>);
