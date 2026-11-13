export type RelayConfig={url:string;read:boolean;write:boolean};
export const DEFAULT_RELAYS:RelayConfig[]=[{url:'wss://yabu.me/',read:true,write:true}];
export const RELAY_STORAGE='petal-relays-v1';
export function normalizeRelay(raw:string){const value=raw.trim();const u=new URL(value.includes('://')?value:'wss://'+value);const h=u.hostname.toLowerCase();if(u.protocol!=='wss:'||u.username||u.password||u.search||u.hash||!h.includes('.')||h.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(h)||/\.(local|localhost|internal)$/.test(h)||u.port&&u.port!=='443')throw Error('公開ホストのwss:// URLを入力してください（認証情報・クエリ不可）');return u.href}
export function parseRelays(value:unknown):RelayConfig[]{if(!Array.isArray(value)||value.length>16)throw Error('リレーは16件までです');const seen=new Set<string>();return value.map(r=>{if(!r||typeof r.url!=='string'||typeof r.read!=='boolean'||typeof r.write!=='boolean')throw Error('リレー設定が不正です');const url=normalizeRelay(r.url);if(seen.has(url))throw Error('同じリレーは追加できません');seen.add(url);return {url,read:r.read,write:r.write}})}
export function canRead(relays:RelayConfig[],url:string){return relays.some(r=>r.url===url&&r.read)}
export function canWrite(relays:RelayConfig[],url:string){return relays.some(r=>r.url===url&&r.write)}
