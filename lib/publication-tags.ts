import {nip19} from 'nostr-tools';
import {normalizeRelay} from './relays';
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function relayHint(values:string[]|undefined){for(const value of values??[]){try{if(!/^wss:\/\//i.test(value))continue;return normalizeRelay(value)}catch{}}return ''}
/** NIP-18/21/27: content references are quote (q), never reply (e), tags.
 * Does not rewrite text, fetch hints, or handle secret-key entities.
 * Existing p/q identities win so reply recipient/known metadata are preserved.
 */
export function buildContentTags(content:string,existingTags:string[][]=[]):string[][]{
 const tags:string[][]=[],seen=new Set<string>();
 function add(tag:string[]){const key=(tag[0]==='p'||tag[0]==='q')?JSON.stringify(tag.slice(0,2)):JSON.stringify(tag);if(seen.has(key))return;seen.add(key);tags.push([...tag])}
 existingTags.forEach(add);
 // Consume the entire alphanumeric token: an invalid suffix must not turn into
 // a valid truncated reference. Adjacent identifier characters are not boundaries.
 const pattern=/(?<![A-Za-z0-9_])nostr:((?:note|nevent|naddr|npub|nprofile)1[A-Za-z0-9]+)(?![A-Za-z0-9_])/gi;
 for(const match of content.matchAll(pattern)){try{const decoded=nip19.decode(match[1]);
 if(decoded.type==='npub'){if(hex(decoded.data))add(['p',decoded.data])}
 else if(decoded.type==='nprofile'){if(hex(decoded.data.pubkey)){const relay=relayHint(decoded.data.relays);add(relay?['p',decoded.data.pubkey,relay]:['p',decoded.data.pubkey])}}
 else if(decoded.type==='note'){if(hex(decoded.data))add(['q',decoded.data])}
 else if(decoded.type==='nevent'){const {id,author,relays}=decoded.data;if(!hex(id))continue;const relay=relayHint(relays);add(hex(author)?['q',id,relay,author]:relay?['q',id,relay]:['q',id]);if(hex(author))add(['p',author])}
 else if(decoded.type==='naddr'){const {kind,pubkey,identifier,relays}=decoded.data;if(!hex(pubkey)||!Number.isSafeInteger(kind)||kind<0||typeof identifier!=='string')continue;const address=`${kind}:${pubkey}:${identifier}`,relay=relayHint(relays);add(relay?['q',address,relay]:['q',address]);add(['p',pubkey])}
 }catch{/* Malformed bech32/TLV or checksum: do not publish a fabricated tag. */}}
 return tags;
}
