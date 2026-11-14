import {assertActive,signDmEvent,verified,type DmSigner,DM_LIMIT} from './direct-messages';
import type {Event,Filter} from 'nostr-tools';
export type DmRelayResult={url:string;events:Event[];ok:boolean;truncated:boolean};
type Options={owner:string;signer:DmSigner;signal:AbortSignal;allowAuth:boolean;timeout?:number};
/** Isolated, bounded snapshot/publication. AUTH never goes through EVENT. */
export function dmRelay(url:string,request:Filter|Event,options:Options):Promise<DmRelayResult>{
 return new Promise(resolve=>{
  const {signal}=options;const lifetime=new AbortController();let socket:WebSocket|undefined,done=false,authId='',challenge='',authStarted=false,retry=false,waitingAuth=false;
  let frames=0;const events=new Map<string,Event>();const writing='sig'in request;const sub='dm-'+crypto.randomUUID();
  const finish=(ok=false)=>{if(done)return;done=true;lifetime.abort();clearTimeout(timer);signal.removeEventListener('abort',abort);if(socket){socket.onclose=null;socket.onerror=null;socket.onmessage=null;try{if(socket.readyState===1&&!writing)socket.send(JSON.stringify(['CLOSE',sub]));socket.close()}catch{/* Already closed. */}}resolve({url,events:[...events.values()],ok,truncated:!writing&&events.size>=Number((request as Filter).limit??DM_LIMIT)})};
  const abort=()=>finish();const timer=setTimeout(()=>finish(),options.timeout??10000);signal.addEventListener('abort',abort,{once:true});
  const send=()=>{if(!done&&!signal.aborted&&socket?.readyState===1)try{socket.send(JSON.stringify(writing?['EVENT',request]:['REQ',sub,request]))}catch{finish()}};
  const authenticate=async()=>{
   if(!options.allowAuth){finish();return}if(!challenge||authStarted)return;authStarted=true;
   try{const signed=await signDmEvent(options.signer,options.owner,{kind:22242,created_at:Math.floor(Date.now()/1000),content:'',tags:[['relay',url],['challenge',challenge]]},lifetime.signal);if(done)return;authId=signed.id;socket?.send(JSON.stringify(['AUTH',signed]))}catch{finish()}
  };
  if(signal.aborted){finish();return}
  try{socket=new WebSocket(url);socket.onopen=send;socket.onerror=()=>finish();socket.onclose=()=>finish();socket.onmessage=({data})=>{
   if(done)return;if(++frames>500){finish();return}if(typeof data!=='string'||data.length>140000)return;
   try{const m=JSON.parse(data);if(!Array.isArray(m))return;
    if(m[0]==='AUTH'&&typeof m[1]==='string'&&m[1].length<=1024){if(challenge&&challenge!==m[1]&&authStarted){finish();return}challenge=m[1];if(waitingAuth)void authenticate();return}
    if(m[0]==='OK'&&authId&&m[1]===authId){if(m[2]===true){retry=true;send()}else finish();return}
    const rejection=(writing&&m[0]==='OK'&&m[1]===(request as Event).id&&m[2]===false)||(!writing&&m[0]==='CLOSED'&&m[1]===sub);
    if(rejection){const reason=writing?m[3]:m[2];if(typeof reason==='string'&&reason.startsWith('auth-required:')&&!retry){waitingAuth=true;void authenticate()}else finish();return}
    if(writing){if(m[0]==='OK'&&m[1]===(request as Event).id&&m[2]===true)finish(true);return}
    if(m[1]!==sub)return;
    if(m[0]==='EOSE'){if(Array.isArray(m[2])&&m[2].includes('auth')){if(retry)finish();else{waitingAuth=true;void authenticate()}}else finish(true)}
    if(m[0]==='EVENT'&&events.size<DM_LIMIT&&verified(m[2])){const e=m[2] as Event,f=request as Filter;if(f.kinds&&!f.kinds.includes(e.kind)||f.authors&&!f.authors.includes(e.pubkey)||f['#p']&&!e.tags.some(t=>t[0]==='p'&&f['#p']!.includes(t[1]))||f.until!==undefined&&e.created_at>f.until)return;events.set(e.id,e)}
   }catch{/* Ignore malformed untrusted frames, never log message contents. */}
  }}catch{finish()}
 });
}
export async function dmQuery(urls:string[],filter:Filter,options:Options){assertActive(options.signal);const results=await Promise.all([...new Set(urls)].slice(0,16).map(url=>dmRelay(url,filter,options)));assertActive(options.signal);return results}
export async function dmPublish(urls:string[],event:Event,options:Options){assertActive(options.signal);const results=await Promise.all([...new Set(urls)].slice(0,16).map(url=>dmRelay(url,event,options)));assertActive(options.signal);return {confirmed:results.filter(r=>r.ok).length,total:results.length}}
