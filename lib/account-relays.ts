import {verifyEvent, type Event, type EventTemplate} from 'nostr-tools';
import {isLatestReplaceable} from './latest-event';
import {parseRelayList} from './relay-discovery';
import {DEFAULT_RELAYS, RELAY_STORAGE, normalizeRelay, parseRelays, type RelayConfig} from './relays';
import {parseRelayFrame, validInboundEvent} from './relay-connections';

export type AccountRelaySnapshot = {event: Event | null; partial: boolean};
export type AccountRelayState = AccountRelaySnapshot & {owner: string; loading: boolean};
/** Legacy browser settings are for guests only. Never read or delete account overrides. */
export function readGuestConnections(storage: Pick<Storage, 'getItem'>): RelayConfig[] | null {
  try {const raw = storage.getItem(RELAY_STORAGE); return raw === null ? null : parseRelays(JSON.parse(raw));} catch {return null;}
}
export function saveGuestConnections(storage: Pick<Storage, 'setItem'>, owner: string, rows: RelayConfig[]) {
  if (owner) throw Error('ログイン中はアカウントのリレー設定を保存してください');
  const config = parseRelays(rows);
  storage.setItem(RELAY_STORAGE, JSON.stringify(config));
  return config;
}
/** Runtime subscriptions are separate from the NIP-65 inbox/outbox editor.
 * Read inboxes and outboxes; only advertised outboxes receive our publications.
 * Missing/empty lists use an internal read-only bootstrap, never a default outbox. */
export function accountConnections(event: Event | null): RelayConfig[] {
  const rows = event ? parseRelayList(event).map(r => ({...r, read: true})) : [];
  return rows.length ? rows : DEFAULT_RELAYS.map(r => ({...r, write: false}));
}
export function relayLookupUrls(event: Event | null, sources: string[] = []): string[] {
  return [...new Set([...DEFAULT_RELAYS.map(r => r.url), ...sources, ...(event ? parseRelayList(event).map(r => r.url) : [])])];
}
/** Profile-only readers do not grant publication permission or alter the account list. */
export function withTemporaryReaders(config: RelayConfig[], urls: string[]): RelayConfig[] {
  const rows = config.map(r => ({...r}));
  for (const raw of urls.slice(0, 16)) {
    const url = normalizeRelay(raw), existing = rows.find(r => r.url === url);
    if (existing) existing.read = true;
    else if (rows.length < 32) rows.push({url, read: true, write: false});
  }
  return rows;
}

/** Opens bounded, short-lived reads, including relays still connecting in the feed pool. */
export async function loadAccountRelayList(owner: string, urls: string[], signal: AbortSignal, timeout = 8000): Promise<AccountRelaySnapshot> {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw Error('公開鍵が不正です');
  if (signal.aborted) throw Error('読み込みを中止しました');
  const targets = [...new Set(urls.map(normalizeRelay))];
  if (!targets.length || targets.length > 48) throw Error('取得先のリレーを確認してください');
  let latest: Event | null = null;
  const results = await Promise.all(targets.map(url => new Promise<boolean>(resolve => {
    let ws: WebSocket | undefined;
    let settled = false, count = 0;
    const id = 'account-relays-' + Math.random().toString(36).slice(2);
    const finish = (complete = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (ws) {ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try {if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', id])); ws.close();} catch { /* already closed */ }}
      resolve(complete);
    };
    const abort = () => finish();
    signal.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(finish, Math.max(1, Math.min(timeout, 8000)));
    try {ws = new WebSocket(url);} catch {finish(); return;}
    if (signal.aborted) {finish(); return;}
    ws.onopen = () => {try {ws!.send(JSON.stringify(['REQ', id, {kinds: [10002], authors: [owner], limit: 1} ]));} catch {finish();}};
    ws.onerror = ws.onclose = () => finish();
    ws.onmessage = message => {
      const frame = parseRelayFrame(message.data);
      if (!frame) {finish(); return;}
      if (frame[1] !== id) return;
      if (frame[0] === 'EOSE') {finish(true); return;}
      if (frame[0] === 'CLOSED') {finish(); return;}
      if (frame[0] !== 'EVENT') return;
      if (++count > 30) {finish(); return;}
      const candidate = frame[2] as Event;
      try {
        if (!validInboundEvent(candidate) || candidate.kind !== 10002 || candidate.pubkey !== owner || !verifyEvent(candidate)) {finish(); return;}
        if (isLatestReplaceable(latest, candidate)) latest = candidate;
      } catch {finish();}
    };
  })));
  if (signal.aborted) throw Error('読み込みを中止しました');
  return {event: latest, partial: results.some(complete => !complete)};
}

/** Account epochs isolate stale results; reconnects coalesce behind an in-flight read. */
export class AccountRelaySession {
  state: AccountRelayState = {owner: '', event: null, partial: true, loading: false};
  private request?: AbortController;
  private pending = false;
  private urls: string[] = [];
  private sources: string[] = [];
  private known = new Map<string, Event>();
  private remember(event: Event | null) {
    if (!event) return;
    this.known.delete(event.pubkey); this.known.set(event.pubkey, event);
    while (this.known.size > 8) this.known.delete(this.known.keys().next().value!);
  }
  constructor(private changed: (state: AccountRelayState) => void, private load = loadAccountRelayList) {}
  start(owner: string, urls: string[]) {
    this.stop(); this.sources = urls;
    const event = this.known.get(owner) ?? null;
    this.urls = relayLookupUrls(event, urls);
    this.state = {owner, event, partial: true, loading: !!owner}; this.changed(this.state);
    if (owner) void this.refresh();
  }
  stop() {this.request?.abort(); this.request = undefined; this.pending = false;}
  reconnect(url: string) {if (!this.state.owner || !this.urls.includes(url)) return; if (this.request) this.pending = true; else void this.refresh();}
  async refresh() {
    if (!this.state.owner) return;
    if (this.request) {this.pending = true; return;}
    const request = new AbortController(), owner = this.state.owner; this.request = request;
    this.state = {...this.state, loading: true}; this.changed(this.state);
    try {
      const result = await this.load(owner, this.urls, request.signal);
      if (this.request !== request || request.signal.aborted) return;
      // Never regress a known event when a relay loses history or temporarily hides it.
      const stale = !!this.state.event && (!result.event || isLatestReplaceable(result.event, this.state.event));
      const event = result.event && isLatestReplaceable(this.state.event, result.event) ? result.event : this.state.event;
      const expanded = relayLookupUrls(event, this.sources);
      const added = expanded.some(url => !this.urls.includes(url));
      this.urls = expanded;
      this.remember(event);
      this.state = {owner, event, partial: result.partial || stale || added, loading: false};
      this.pending = added || this.pending && result.partial;
    } catch {if (this.request !== request || request.signal.aborted) return; this.state = {...this.state, partial: true, loading: false};}
    if (this.request !== request) return;
    this.request = undefined; this.changed(this.state);
    if (this.pending) {this.pending = false; void this.refresh();}
  }
  observe(result: AccountRelaySnapshot) {
    if (result.event && result.event.pubkey !== this.state.owner) return;
    this.stop();
    const stale = !!this.state.event && (!result.event || isLatestReplaceable(result.event, this.state.event));
    const event = result.event && isLatestReplaceable(this.state.event, result.event) ? result.event : this.state.event;
    this.urls = relayLookupUrls(event, this.sources);
    this.remember(event);
    this.state = {...this.state, event, partial: result.partial || stale, loading: false}; this.changed(this.state);
  }
  accept(event: Event) {
    if (event.pubkey !== this.state.owner) return;
    // Cancel a read started before publication, which could otherwise report stale state.
    this.stop(); this.urls = relayLookupUrls(event, this.sources);
    if (isLatestReplaceable(this.state.event, event)) this.state = {...this.state, event, partial: false, loading: false};
    this.remember(this.state.event);
    this.changed(this.state);
  }
}

/** Refuse lossy editing of lists beyond this client's URL/size/marker support. */
export function editableRelayRows(event: Event | null): RelayConfig[] {
  if (!event) return [];
  const tags = event.tags.filter(t => t[0] === 'r');
  for (const tag of tags) {
    if (tag.length < 2 || tag.length > 3 || tag[2] !== undefined && !['read', 'write'].includes(tag[2])) throw Error('この公開一覧には未対応のリレー指定が含まれるため編集できません');
    try {normalizeRelay(tag[1]);} catch {throw Error('この公開一覧には未対応のURLが含まれるため編集できません');}
  }
  if (new Set(tags.map(t => normalizeRelay(t[1]))).size > 16) throw Error('16件を超える公開一覧は編集できません');
  return parseRelayList(event);
}
export function buildRelayListEdit(base: Event | null, latest: Event | null, rows: RelayConfig[], now = Math.floor(Date.now() / 1000)): EventTemplate {
  if ((base?.id ?? null) !== (latest?.id ?? null)) throw Error('公開一覧が別の場所で更新されました。再読み込みしてください');
  if (latest && now <= latest.created_at) throw Error('更新時刻が重なっています。少し待ってから保存してください');
  editableRelayRows(latest);
  const parsed = parseRelays(rows);
  if (parsed.some(r => !r.read && !r.write)) throw Error('受信先か投稿先を選択してください。不要なリレーは削除できます');
  return {kind: 10002, created_at: now, content: latest?.content ?? '', tags: [
    ...(latest?.tags.filter(t => t[0] !== 'r').map(t => [...t]) ?? []),
    ...parsed.map(r => r.read && r.write ? ['r', r.url] : ['r', r.url, r.read ? 'read' : 'write']),
  ]};
}
export async function saveAccountRelayList(args: {
  owner: string; base: Event | null; rows: RelayConfig[]; signal: AbortSignal; currentOwner: () => string;
  load: () => Promise<AccountRelaySnapshot>; sign: (event: EventTemplate) => Promise<Event>;
  publish: (event: Event) => Promise<{confirmed: number; total: number}>;
}) {
  const check = () => {if (args.signal.aborted) throw Error('保存を中止しました'); if (args.currentOwner() !== args.owner) throw Error('ログイン状態が変わりました');};
  const load = async () => {const result = await args.load(); check(); if (result.partial) throw Error('一部のリレーを確認できません。再読み込みしてから保存してください'); return result.event;};
  check(); const latest = await load();
  const unsigned = buildRelayListEdit(args.base, latest, args.rows), expected = JSON.stringify(unsigned);
  const returned = await args.sign(unsigned); check();
  // Own the signed payload before the asynchronous conflict check: an extension must
  // not be able to mutate an already-verified object while a relay lookup is pending.
  const signed: Event = {id: returned.id, pubkey: returned.pubkey, kind: returned.kind, created_at: returned.created_at, content: returned.content, tags: returned.tags.map(tag => [...tag]), sig: returned.sig};
  if (signed.pubkey !== args.owner || JSON.stringify({kind: signed.kind, created_at: signed.created_at, content: signed.content, tags: signed.tags}) !== expected || !verifyEvent({id:signed.id,pubkey:signed.pubkey,kind:signed.kind,created_at:signed.created_at,content:signed.content,tags:signed.tags,sig:signed.sig})) throw Error('署名した内容を確認できません');
  const fresh = await load();
  if ((fresh?.id ?? null) !== (latest?.id ?? null)) throw Error('署名中に公開一覧が更新されました。再読み込みしてください');
  const receipt = await args.publish(signed);
  return {...receipt, event: signed};
}

/** Explicit NIP-65 publication to old/new list relays and discovery relays, with per-target ACKs. */
export async function publishAccountRelayList(event: Event, urls: string[], signal: AbortSignal, timeout = 8000) {
  const targets = [...new Set(urls.map(normalizeRelay))];
  if (!targets.length || targets.length > 48) throw Error('公開先のリレーを確認してください');
  const results = await Promise.all(targets.map(url => new Promise<boolean>(resolve => {
    let ws: WebSocket | undefined, settled = false;
    const finish = (accepted = false) => {if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (ws) {ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try {ws.close();} catch { /* already closed */ }} resolve(accepted);};
    const abort = () => finish();
    const timer = setTimeout(finish, Math.max(1, Math.min(timeout, 8000)));
    if (signal.aborted) {finish(); return;}
    signal.addEventListener('abort', abort, {once: true});
    try {ws = new WebSocket(url);} catch {finish(); return;}
    ws.onopen = () => {if (signal.aborted) {finish(); return;} try {ws!.send(JSON.stringify(['EVENT', event]));} catch {finish();}};
    ws.onerror = ws.onclose = () => finish();
    ws.onmessage = message => {const frame = parseRelayFrame(message.data); if (frame?.[0] === 'OK' && frame[1] === event.id && typeof frame[2] === 'boolean') finish(frame[2]);};
  })));
  return {confirmed: results.filter(Boolean).length, total: targets.length};
}
