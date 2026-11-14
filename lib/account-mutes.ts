import {verifyEvent, type Event, type EventTemplate} from 'nostr-tools';
import {isLatestReplaceable} from './latest-event';
import {normalizeWord} from './mutes';

export type MuteType = 'p' | 'word' | 't' | 'e';
export type MuteSigner = {
 signEvent: (event: EventTemplate) => Promise<Event>;
 nip44?: {encrypt: (pubkey: string, text: string) => Promise<string>; decrypt: (pubkey: string, text: string) => Promise<string>};
};
export type MuteList = {event: Event | null; privateTags: string[][] | null; warning: string};
export type MuteEdit = {scope: 'public' | 'private'; type: MuteType; value: string; remove?: boolean};
export type MuteSnapshot = {event: Event | null; complete: boolean};
const hex = (s: string) => /^[a-f0-9]{64}$/.test(s);
export function validMuteList(e: Event, owner: string): boolean {
 try {return e.kind === 10000 && e.pubkey === owner && Number.isSafeInteger(e.created_at) && e.created_at >= 0 && e.content.length <= 100000 && e.tags.length <= 10000 && verifyEvent({id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig});} catch {return false;}
}
export async function readMuteList(event: Event | null, owner: string, signer?: MuteSigner): Promise<MuteList> {
 if (!event) return {event, privateTags: [], warning: ''};
 if (!validMuteList(event, owner)) throw Error('ミュート一覧の署名を確認できません');
 if (!event.content) return {event, privateTags: [], warning: ''};
 // Deprecated NIP-04 is deliberately not decrypted or migrated implicitly.
 if (event.content.includes('?iv=')) return {event, privateTags: null, warning: '旧形式（NIP-04）の非公開一覧は編集できません'};
 try {
  if (!signer?.nip44) throw Error();
  const tags: unknown = JSON.parse(await signer.nip44.decrypt(owner, event.content));
  if (!Array.isArray(tags) || tags.length > 10000 || !tags.every(t => Array.isArray(t) && t.every(v => typeof v === 'string'))) throw Error();
  return {event, privateTags: tags, warning: ''};
 } catch {return {event, privateTags: null, warning: '非公開一覧を復号できません。保存は無効です'};}
}
export function muteValue(type: MuteType, value: string): string {
 const normalized = type === 'word' || type === 't' ? normalizeWord(value).replace(type === 't' ? /^#/ : /$^/, '') : value.trim().toLowerCase();
 if (!normalized || normalized.length > 200 || ((type === 'p' || type === 'e') && !hex(normalized))) throw Error('ミュートする値を確認してください');
 return normalized;
}
export function editableMute(tag: string[]): boolean {
 return ['p', 'word', 't', 'e'].includes(tag[0]) && typeof tag[1] === 'string' && Boolean(normalizeWord(tag[1])) && ((tag[0] !== 'p' && tag[0] !== 'e') || hex(tag[1]));
}
export function accountEventMuted(event: {id?: string; pubkey: string; content: string; kind?: number; tags?: string[][]}, list: MuteList | null): boolean {
 const tags = [...(list?.event?.tags ?? []), ...(list?.privateTags ?? [])];
 const matches = (e: typeof event) => tags.some(t => editableMute(t) && (
  t[0] === 'p' ? t[1] === e.pubkey : t[0] === 'word' ? normalizeWord(e.content).includes(normalizeWord(t[1])) :
  t[0] === 't' ? e.tags?.some(x => x[0] === 't' && normalizeWord(x[1] ?? '') === normalizeWord(t[1])) :
  t[1] === e.id || e.tags?.some(x => x[0] === 'e' && x[1] === t[1] && (e.kind !== 1 || !x[3] || ['root', 'reply'].includes(x[3])))
 ));
 if (matches(event)) return true;
 if (event.kind === 6) {
  if (tags.some(t => t[0] === 'p' && event.tags?.some(x => x[0] === 'p' && x[1] === t[1]))) return true;
  try {const inner = JSON.parse(event.content); if (typeof inner.pubkey === 'string' && typeof inner.content === 'string' && Array.isArray(inner.tags)) return matches(inner);} catch {}
 }
 return false;
}
export async function saveMuteEdit(args: {owner: string; base: MuteList; edit: MuteEdit; signal: AbortSignal; currentOwner: () => string; load: () => Promise<MuteSnapshot>; signer: MuteSigner; publish: (event: Event) => Promise<{confirmed: number; total: number}>}) {
 const check = () => {if (args.signal.aborted || args.currentOwner() !== args.owner) throw Error('操作を中止しました。アカウントを確認してください');};
 const fresh = async () => {check(); const result = await args.load(); check(); if (!result.complete) throw Error('一部のリレーが未応答です。再読み込みしてください'); if ((result.event?.id ?? null) !== (args.base.event?.id ?? null)) throw Error('一覧が更新されました。再読み込みしてください');};
 check();
 if (args.base.privateTags === null || args.base.event && !validMuteList(args.base.event, args.owner)) throw Error('読めない一覧は上書きできません');
 await fresh();
 const {scope, type, remove} = args.edit, value = remove ? args.edit.value : muteValue(type, args.edit.value);
 if (!['p', 'word', 't', 'e'].includes(type) || !['public', 'private'].includes(scope)) throw Error('項目を確認してください');
 let tags = (args.base.event?.tags ?? []).map(t => [...t]), privateTags = args.base.privateTags.map(t => [...t]);
 const source = scope === 'public' ? tags : privateTags;
 const changed = remove ? source.filter(t => !(t[0] === type && t[1] === value)) : source.some(t => t[0] === type && t[1] === value) ? source : [...source, [type, value]];
 if (changed.length > 10000) throw Error('一覧が大きすぎます');
 if (scope === 'public') tags = changed; else privateTags = changed;
 let content = args.base.event?.content ?? '';
 if (scope === 'private') {
  if (!args.signer.nip44) throw Error('NIP-44 対応の署名機能が必要です');
  content = await args.signer.nip44.encrypt(args.owner, JSON.stringify(privateTags)); check();
  if (content.length < 132 || content.length > 100000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || atob(content).charCodeAt(0) !== 2) throw Error('NIP-44 暗号化を確認できません');
  // Detect malformed/mutated signer output before signing or publishing.
  if (await args.signer.nip44.decrypt(args.owner, content) !== JSON.stringify(privateTags)) throw Error('暗号化された内容が一致しません'); check();
 }
 const created_at = Math.floor(Date.now() / 1000);
 if (args.base.event && created_at <= args.base.event.created_at) throw Error('少し待ってから保存してください');
 const unsigned = {kind: 10000, created_at, tags, content}, expected = JSON.stringify(unsigned);
 const signed = await args.signer.signEvent(unsigned); check();
 if (!validMuteList(signed, args.owner) || JSON.stringify({kind: signed.kind, created_at: signed.created_at, tags: signed.tags, content: signed.content}) !== expected) throw Error('署名された内容が一致しません');
 await fresh(); check();
 const receipt = await args.publish(signed); check();
 return {...receipt, list: {event: signed, privateTags, warning: ''} satisfies MuteList};
}

/** Every selected relay must reach EOSE before edits; partial results remain usable for filtering. */
export async function loadMuteList(owner: string, urls: string[], signal: AbortSignal): Promise<MuteSnapshot> {
 if (!hex(owner) || !urls.length || urls.length > 32) throw Error('読み書き用リレーを確認してください');
 let latest: Event | null = null;
 const results = await Promise.allSettled([...new Set(urls)].map(url => new Promise<void>((resolve, reject) => {
  let ws: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined = undefined, done = false, count = 0;
  const id = 'mutes-' + Math.random().toString(36).slice(2);
  const finish = (error?: Error) => {if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (ws) {ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try {if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', id])); ws.close();} catch {}} if (error) reject(error); else resolve();};
  const abort = () => finish(Error('中止しました'));
  if (signal.aborted) {abort(); return;}
  try {const parsed = new URL(url); if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.hash) throw Error(); ws = new WebSocket(url);} catch {finish(Error('リレーURLを確認してください')); return;}
  signal.addEventListener('abort', abort, {once: true}); timer = setTimeout(() => finish(Error('取得がタイムアウトしました')), 10000);
  ws.onopen = () => {try {ws!.send(JSON.stringify(['REQ', id, {kinds: [10000], authors: [owner], limit: 10} ]));} catch {finish(Error('取得できません'));}};
  ws.onerror = ws.onclose = () => finish(Error('接続が切れました'));
  ws.onmessage = message => {
   try {
    if (typeof message.data !== 'string' || message.data.length > 250000) throw Error();
    const frame = JSON.parse(message.data); if (frame[1] !== id) return;
    if (frame[0] === 'EOSE') {finish(); return;}
    if (frame[0] === 'CLOSED') throw Error();
    if (frame[0] !== 'EVENT') return;
    if (++count > 30 || !validMuteList(frame[2], owner)) throw Error();
    if (isLatestReplaceable(latest, frame[2])) latest = frame[2];
   } catch {finish(Error('一覧を安全に取得できません'));}
  };
 })));
 if (signal.aborted) throw Error('読み込みを中止しました');
 return {event: latest, complete: results.every(r => r.status === 'fulfilled')};
}
