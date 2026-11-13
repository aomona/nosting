import {normalizeRelay} from './relays';
const cache=new Map<string,{expires:number;value:boolean|undefined}>();
export const SEARCH_RELAY_SUGGESTIONS=['wss://relay.nostr.band/','wss://search.nos.today/'] as const;
/** A NIP-11 declaration is not a guarantee of uptime, access or search results. */
export async function supportsSearch(raw:string,signal?:AbortSignal):Promise<boolean|undefined>{
 let url:string;try{url=normalizeRelay(raw)}catch{return undefined}if(signal?.aborted)return undefined;
 const saved=cache.get(url);if(saved&&saved.expires>Date.now())return saved.value;
 const abort=new AbortController(),cancel=()=>abort.abort(),timer=setTimeout(cancel,6000);signal?.addEventListener('abort',cancel,{once:true});let value:boolean|undefined;
 try{
  const endpoint=new URL(url);endpoint.protocol='https:';
  const r=await fetch(endpoint.href,{headers:{Accept:'application/nostr+json'},signal:abort.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
  if(r.ok&&r.body){const reader=r.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000){await reader.cancel();throw Error('NIP-11 response too large')}chunks.push(part.value)}}finally{reader.releaseLock()}
   const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length}const data=JSON.parse(new TextDecoder().decode(buffer));if(data&&Array.isArray(data.supported_nips))value=data.supported_nips.includes(50);
  }
 }catch{}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
 if(signal?.aborted)return undefined;
 while(cache.size>=128)cache.delete(cache.keys().next().value!);
 cache.set(url,{value,expires:Date.now()+(value===undefined?30000:300000)});return value;
}
