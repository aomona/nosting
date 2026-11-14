/** Browser-side NIP-05 lookup. Never proxy arbitrary destinations through our server. */
export const NIP05_CACHE_MS = 5 * 60 * 1000;
const FAILURE_CACHE_MS = 30 * 1000;
const MAX_BODY_BYTES = 128 * 1024;
export type Nip05Address = {identifier:string; name:string; url:string};
export type Nip05Result = {status:'resolved'; pubkey:string} | {status:'invalid'|'unavailable'|'missing'|'cancelled'};

export function parseNip05(input:string):Nip05Address|null {
 if (typeof input !== 'string' || input.length > 320) return null;
 const parts = input.split('@');
 if (parts.length !== 2 || !parts[0] || /[^a-z0-9_.-]/.test(parts[0])) return null;
 const [name, rawDomain] = parts;
 const domain = rawDomain.toLowerCase();
 // Only DNS names: no credentials, ports, IP literals, paths, or local hostnames.
 if (domain.length > 253 || /[^a-z0-9.-]/.test(domain) || !domain.includes('.') || /\.(?:local|localhost|internal|lan|home|localdomain)$/.test(domain)) return null;
 if (!domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/[a-z]/.test(domain.split('.').at(-1)!)) return null;
 try {
  const url = new URL(`https://${domain}/.well-known/nostr.json`);
  if (url.hostname !== domain) return null;
  url.searchParams.set('name', name);
  return {identifier:`${name}@${domain}`,name,url:url.href};
 } catch { return null; }
}

/** Bounded, expiring cache; cancelled lookups never poison later requests. */
export class Nip05Resolver {
 private cache = new Map<string,{expires:number; result:Nip05Result}>();
 constructor(private fetcher:typeof fetch = (...args) => fetch(...args), private now = Date.now, private timeoutMs = 5000) {}
 async resolve(input:string, externalSignal?:AbortSignal):Promise<Nip05Result> {
  if (externalSignal?.aborted) return {status:'cancelled'};
  const address = parseNip05(input);
  if (!address) return {status:'invalid'};
  const cached = this.cache.get(address.identifier);
  if (cached && cached.expires > this.now()) return cached.result;
  this.cache.delete(address.identifier);
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort, this.timeoutMs);
  let result:Nip05Result = {status:'unavailable'};
  try {
   const response = await this.fetcher(address.url, {signal:controller.signal, redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store', headers:{Accept:'application/json'}});
   if (!response.ok || response.redirected || !response.body || Number(response.headers.get('content-length')) > MAX_BODY_BYTES) throw Error('Invalid response');
   const reader = response.body.getReader();
   let size = 0, text = '';
   const decoder = new TextDecoder();
   try {
    for (;;) {
     const chunk = await reader.read();
     if (chunk.done) break;
     size += chunk.value.byteLength;
     if (size > MAX_BODY_BYTES) throw Error('Response too large');
     text += decoder.decode(chunk.value,{stream:true});
    }
    text += decoder.decode();
   } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
   const data:unknown = JSON.parse(text);
   if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid document');
   const names = (data as {names?:unknown}).names;
   if (!names || typeof names !== 'object' || Array.isArray(names)) throw Error('Invalid names');
   const key = Object.hasOwn(names,address.name) ? (names as Record<string,unknown>)[address.name] : undefined;
   result = typeof key === 'string' && key.length === 64 && /^[a-f0-9]{64}$/.test(key) ? {status:'resolved',pubkey:key} : {status:'missing'};
  } catch { /* Network, CORS, redirect and timeout failures mean unconfirmed. */ }
  finally {clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
  if (externalSignal?.aborted) return {status:'cancelled'};
  if (controller.signal.aborted) result = {status:'unavailable'};
  this.cache.set(address.identifier,{result,expires:this.now() + (result.status === 'resolved' ? NIP05_CACHE_MS : FAILURE_CACHE_MS)});
  while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
  return result;
 }
}
export const nip05Resolver = new Nip05Resolver();
