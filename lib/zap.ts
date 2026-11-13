import {bech32} from '@scure/base';
import {decode} from 'light-bolt11-decoder';
import {verifyEvent,type Event as NostrEvent,type EventTemplate} from 'nostr-tools';
import {safeMediaUrl} from './note-media';
export type ZapTarget={id:string;pubkey:string;tags:string[][]};
export type ZapProfile={lud16?:string;lud06?:string;name?:string};
export type ZapEndpoint={url:string;lnurl:string;callback:string;min:number;max:number;provider:string};
export type ZapInvoice={invoice:string;request:NostrEvent;endpoint:ZapEndpoint;amount:number;expires:number};
const hex=/^[a-f0-9]{64}$/;
function safe(value:string){const url=safeMediaUrl(value);if(!url||new URL(url).hash)throw Error('安全な HTTPS の送金先ではありません');return url}
export function lightningEndpoint(profile:ZapProfile){
 if(profile.lud16){const m=/^([^@\s/?#]+)@([^@\s/:?#]+)$/.exec(profile.lud16.trim());if(!m)throw Error('Lightning アドレスが不正です');return safe(`https://${m[2]}/.well-known/lnurlp/${encodeURIComponent(m[1])}`)}
 if(profile.lud06){try{const b=bech32.decode(profile.lud06.trim() as `${string}1${string}`,2048);if(b.prefix!=='lnurl')throw Error();return safe(new TextDecoder('utf-8',{fatal:true}).decode(bech32.fromWords(b.words)))}catch{throw Error('LNURL が不正です')}}
 throw Error('このプロフィールには Zap の受取先がありません');
}
export async function fetchZapJson(url:string,signal?:AbortSignal):Promise<Record<string,unknown>>{
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,10000);
 try{const r=await fetch(safe(url),{signal:controller.signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});if(!r.ok)throw Error(`送金先が応答しませんでした (${r.status})`);const reader=r.body?.getReader();if(!reader)throw Error('空の応答です');const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('送金先の応答が大きすぎます');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}const all=new Uint8Array(size);let at=0;for(const c of chunks){all.set(c,at);at+=c.length}const data=JSON.parse(new TextDecoder().decode(all));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('送金先の応答が不正です');if(data.status==='ERROR')throw Error('送金先がリクエストを拒否しました');return data}catch(e){if(e instanceof TypeError)throw Error('送金先へ接続できません。CORS 制限またはネットワーク障害の可能性があります');if(controller.signal.aborted)throw Error('接続を中止しました（タイムアウトを含みます）');throw e}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
export function parseZapEndpoint(url:string,d:Record<string,unknown>):ZapEndpoint{
 if(d.tag!=='payRequest'||d.allowsNostr!==true||typeof d.nostrPubkey!=='string'||!hex.test(d.nostrPubkey))throw Error('送金先が Nostr Zap に対応していません');
 const min=Number(d.minSendable),max=Number(d.maxSendable);if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<1||max<min||typeof d.callback!=='string')throw Error('送金先の金額設定が不正です');
 return {url:safe(url),lnurl:bech32.encode('lnurl',bech32.toWords(new TextEncoder().encode(safe(url))),2048),callback:safe(d.callback),min,max,provider:d.nostrPubkey};
}
export async function loadZapEndpoint(profile:ZapProfile,signal?:AbortSignal){const url=lightningEndpoint(profile);return parseZapEndpoint(url,await fetchZapJson(url,signal))}
export function makeZapRequest(target:ZapTarget,endpoint:ZapEndpoint,sats:number,relays:string[]):EventTemplate{
 if(target.tags.some(t=>t[0]==='zap'))throw Error('複数の送金先を指定した投稿にはまだ対応していません');
 if(!hex.test(target.id)||!hex.test(target.pubkey))throw Error('投稿の識別子が不正です');const amount=sats*1000;if(!Number.isSafeInteger(sats)||sats<=0||!Number.isSafeInteger(amount)||amount<endpoint.min||amount>endpoint.max)throw Error('受取先の範囲内の整数 sat を入力してください');
 const urls=[...new Set(relays.filter(r=>{try{const u=new URL(r);return u.protocol==='wss:'&&!u.username&&!u.password}catch{return false}}))].slice(0,16);if(!urls.length)throw Error('受領通知用の読み取りリレーを設定してください');
 return {kind:9734,created_at:Math.floor(Date.now()/1000),content:'',tags:[['relays',...urls],['amount',String(amount)],['lnurl',endpoint.lnurl],['p',target.pubkey],['e',target.id]]};
}
async function sha(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function validateZapInvoice(invoice:string,request:NostrEvent,now=Math.floor(Date.now()/1000)){
 if(invoice.length>12000||!/^lnbc/i.test(invoice))throw Error('Bitcoin メインネットの請求書ではありません');
 let sections:{name:string;value?:unknown;letters?:string}[];try{sections=decode(invoice).sections}catch{throw Error('請求書を読み取れませんでした')}
 const one=(name:string)=>{const values=sections.filter(s=>s.name===name);if(values.length!==1)throw Error('請求書の必須項目が不正です');return values[0].value};
 if(String(one('amount'))!==request.tags.find(t=>t[0]==='amount')?.[1])throw Error('請求額が指定金額と一致しません');
 if(one('description_hash')!==await sha(JSON.stringify(request)))throw Error('請求書が署名した Zap と一致しません');
 if(!hex.test(String(one('payment_hash'))))throw Error('請求書の支払識別子が不正です');
 const timestamp=Number(one('timestamp')),expiryTags=sections.filter(s=>s.name==='expiry');if(expiryTags.length>1)throw Error('請求書の期限が不正です');const expiry=Number(expiryTags[0]?.value??3600),expires=timestamp+expiry;if(!Number.isSafeInteger(expires)||expiry<=0||timestamp>now+60||expires<=now)throw Error('請求書の有効期限が切れているか不正です');return expires;
}
export async function requestZapInvoice(target:ZapTarget,endpoint:ZapEndpoint,sats:number,relays:string[],pubkey:string,sign:(e:EventTemplate)=>Promise<NostrEvent>,signal?:AbortSignal):Promise<ZapInvoice>{
 const unsigned=makeZapRequest(target,endpoint,sats,relays),request=await sign(unsigned);
 if(signal?.aborted)throw Error('キャンセルしました');
 if(!verifyEvent(request)||request.pubkey!==pubkey||request.kind!==unsigned.kind||request.created_at!==unsigned.created_at||request.content!==unsigned.content||JSON.stringify(request.tags)!==JSON.stringify(unsigned.tags))throw Error('署名内容が一致しません');
 const url=new URL(endpoint.callback);url.searchParams.set('amount',String(sats*1000));url.searchParams.set('nostr',JSON.stringify(request));url.searchParams.set('lnurl',endpoint.lnurl);
 const d=await fetchZapJson(url.href,signal);if(typeof d.pr!=='string')throw Error('請求書が返されませんでした');const expires=await validateZapInvoice(d.pr,request);return {invoice:d.pr,request,endpoint,amount:sats,expires};
}
export async function validateZapReceipt(receipt:NostrEvent,invoice:ZapInvoice){
 try{if(receipt.kind!==9735||receipt.pubkey!==invoice.endpoint.provider||!verifyEvent(receipt))return false;const tag=(k:string)=>{const ts=receipt.tags.filter(t=>t[0]===k);return ts.length===1?ts[0][1]:undefined};if(tag('bolt11')!==invoice.invoice||tag('description')!==JSON.stringify(invoice.request)||tag('p')!==invoice.request.tags.find(t=>t[0]==='p')?.[1]||tag('e')!==invoice.request.tags.find(t=>t[0]==='e')?.[1])return false;if(!verifyEvent(invoice.request))return false;await validateZapInvoice(invoice.invoice,invoice.request,invoice.request.created_at);return true}catch{return false}
}
/** Read-only, invoice-scoped subscription. Never connects to provider relay hints. */
export function watchZapReceipt(invoice:ZapInvoice,urls:string[],onReceipt:()=>void,createSocket:(url:string)=>WebSocket=url=>new WebSocket(url)){
 let stopped=false;const sockets:WebSocket[]=[];const seen=new Set<string>();const id=`zap-${invoice.request.id.slice(0,12)}`;let count=0;let timer:ReturnType<typeof setTimeout>;
 const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);for(const ws of sockets){try{if(ws.readyState===1)ws.send(JSON.stringify(['CLOSE',id]));ws.close()}catch{}}};
 const remaining=invoice.expires*1000-Date.now();if(remaining<=0)return stop;timer=setTimeout(stop,Math.min(remaining,3600000));
 for(const url of [...new Set(urls)].slice(0,16)){try{const u=new URL(url);if(u.protocol!=='wss:'||u.username||u.password)continue;const ws=createSocket(url);sockets.push(ws);ws.onopen=()=>{if(stopped){ws.close();return}try{ws.send(JSON.stringify(['REQ',id,{kinds:[9735],authors:[invoice.endpoint.provider],'#e':[invoice.request.tags.find(t=>t[0]==='e')![1]],since:invoice.request.created_at-60,limit:20}]))}catch{ws.close()}};ws.onmessage=async e=>{if(stopped||typeof e.data!=='string'||e.data.length>32768)return;if(++count>320){stop();return}try{const frame=JSON.parse(e.data);if(frame[0]!=='EVENT'||frame[1]!==id)return;const event=frame[2] as NostrEvent;if(!event||seen.has(event.id))return;seen.add(event.id);if(await validateZapReceipt(event,invoice)&&!stopped){onReceipt();stop()}}catch{}};ws.onerror=()=>{try{ws.close()}catch{}}}catch{}}
 return stop;
}
