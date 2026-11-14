import {verifyEvent,type Event} from 'nostr-tools';
import {nip05Resolver,parseNip05,type Nip05Resolver} from './nip05';
import {readProfile,type Profile} from './profiles';

export type Nip05ProfileResult = {status:'found';pubkey:string;profile:Profile;partial:boolean} | {status:'unconfirmed'|'cancelled'};
/** Read only from the user's configured relays. NIP-05 relay hints never add connections. */
export async function findNip05Profile(identifier:string, relays:string[], signal:AbortSignal, resolver:Nip05Resolver = nip05Resolver, timeoutMs = 8000):Promise<Nip05ProfileResult> {
 const address = parseNip05(identifier);
 const resolved = await resolver.resolve(identifier,signal);
 if (signal.aborted || resolved.status === 'cancelled') return {status:'cancelled'};
 if (!address || resolved.status !== 'resolved') return {status:'unconfirmed'};
 const urls = [...new Set(relays)];
 if (!urls.length || urls.length > 32) return {status:'unconfirmed'};
 let latest:Event|undefined;
 const results = await Promise.all(urls.map(url => new Promise<boolean>(resolve => {
  let ws:WebSocket|undefined, settled = false, count = 0;
  const id = 'nip05-' + Math.random().toString(36).slice(2);
  const timer = setTimeout(() => finish(false),timeoutMs);
  const finish = (complete:boolean) => {
   if (settled) return;
   settled = true;clearTimeout(timer);signal.removeEventListener('abort',abort);
   if (ws) {ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try {if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE',id]));ws.close();} catch {}}
   resolve(complete);
  };
  const abort = () => finish(false);
  if (signal.aborted) {finish(false);return;}
  try {
   const u = new URL(url);
   if (u.protocol !== 'wss:' || u.username || u.password || u.hash) throw Error('Invalid relay');
   ws = new WebSocket(url);
  } catch {finish(false);return;}
  signal.addEventListener('abort',abort,{once:true});
  ws.onopen = () => {try {ws!.send(JSON.stringify(['REQ',id,{authors:[resolved.pubkey],kinds:[0],limit:10}]))} catch {finish(false)}};
  ws.onerror=ws.onclose=() => finish(false);
  ws.onmessage = message => {
   try {
    if (typeof message.data !== 'string' || message.data.length > 100000) {finish(false);return;}
    const frame = JSON.parse(message.data);
    if (!Array.isArray(frame) || frame[1] !== id) return;
    if (frame[0] === 'EOSE') {finish(true);return;}
    if (frame[0] === 'CLOSED') {finish(false);return;}
    if (frame[0] !== 'EVENT') return;
    if (++count > 30) {finish(false);return;}
    const ev = frame[2] as Event;
    if (ev?.kind !== 0 || ev.pubkey !== resolved.pubkey || !Number.isSafeInteger(ev.created_at) || ev.created_at < 0 || !verifyEvent(ev)) return;
    // Keep the newest signed event even when its metadata is malformed; never fall back to stale claims.
    if (!latest || ev.created_at > latest.created_at || ev.created_at === latest.created_at && ev.id < latest.id) latest = ev;
   } catch { /* Ignore invalid frames/events. */ }
  };
 })));
 if (signal.aborted) return {status:'cancelled'};
 if (!latest) return {status:'unconfirmed'};
 const profile = readProfile(latest);
 if (!profile || parseNip05(profile.nip05)?.identifier !== address.identifier) return {status:'unconfirmed'};
 return {status:'found',pubkey:resolved.pubkey,profile,partial:results.some(complete => !complete)};
}
