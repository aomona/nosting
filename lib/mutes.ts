/** Browser-local preferences only. Never serialize these as Nostr events. */
export type LocalMutes={users:string[];words:string[]};
export const emptyMutes=():LocalMutes=>({users:[],words:[]});
export const muteStorageKey=(pubkey:string)=>'petal-local-mutes-v1:'+(/^[a-f0-9]{64}$/.test(pubkey)?pubkey:'guest');
export const normalizeWord=(word:string)=>word.normalize('NFKC').trim().toLocaleLowerCase('und');
export function parseMutes(value:unknown):LocalMutes{
 const v=value as Partial<LocalMutes>|null;
 return {users:[...new Set(Array.isArray(v?.users)?v.users.filter((s):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)):[])].slice(0,2000),words:[...new Set(Array.isArray(v?.words)?v.words.filter((s):s is string=>typeof s==='string').map(normalizeWord).filter(s=>s.length>0&&s.length<=200):[])].slice(0,500)};
}
export function isEventMuted(event:{pubkey:string;content:string;kind?:number;tags?:string[][]},mutes:LocalMutes):boolean{
 if(mutes.users.includes(event.pubkey)||mutes.words.some(word=>normalizeWord(event.content).includes(word)))return true;
 // An outer repost must not bypass a muted original author or original content.
 if(event.kind===6){if(event.tags?.some(t=>t[0]==='p'&&mutes.users.includes(t[1])))return true;try{const inner=JSON.parse(event.content);if(typeof inner.pubkey==='string'&&typeof inner.content==='string')return mutes.users.includes(inner.pubkey)||mutes.words.some(word=>normalizeWord(inner.content).includes(word))}catch{}}
 return false;
}
export function addLocalMute(mutes:LocalMutes,kind:'users'|'words',value:string):{mutes:LocalMutes;error?:string}{
 const normalized=kind==='users'?value.trim().toLowerCase():normalizeWord(value);
 if(kind==='users'&&!/^[a-f0-9]{64}$/.test(normalized))return {mutes,error:'64桁の16進数の公開鍵を入力してください。'};
 if(kind==='words'&&(!normalized||normalized.length>200))return {mutes,error:'ワードは1〜200文字で入力してください。'};
 if(mutes[kind].includes(normalized))return {mutes};
 const limit=kind==='users'?2000:500;
 if(mutes[kind].length>=limit)return {mutes,error:`ミュートの上限（${limit}件）に達しました。先に不要な項目を解除してください。`};
 return {mutes:{...mutes,[kind]:[...mutes[kind],normalized]}};
}
