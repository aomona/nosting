import {verifyEvent, type Event, type Filter} from 'nostr-tools';
import {isLatestReplaceable} from './latest-event';
import {normalizeRelay} from './relays';
import {parseRelayFrame, validInboundEvent} from './relay-connections';

const hex = /^[a-f0-9]{64}$/;
export type BookmarkData = {local: string[]; hidden: string[]; event: Event | null};
export type BookmarkItem = {id: string; event?: Event; status: 'pending' | 'ready' | 'missing' | 'failed' | 'deleted'};
export type BookmarkState = {owner: string; ready: boolean; loading: boolean; partial: boolean; error: string; data: BookmarkData; items: BookmarkItem[]};
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
export const bookmarkKey = (owner: string) => {
  if (owner && !hex.test(owner)) throw Error('公開鍵が不正です');
  return 'petal-bookmarks:v2:' + (owner || 'guest');
};
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && hex.test(id)))] : [];
export const emptyBookmarkData = (): BookmarkData => ({local: [], hidden: [], event: null});
function verified(event: Event): boolean {
  try {return validInboundEvent(event) && verifyEvent(event);} catch {return false;}
}
export function readBookmarks(storage: StorageAccess, owner: string): BookmarkData {
  const key = bookmarkKey(owner), raw = storage.getItem(key);
  if (raw === null) {
    const data = emptyBookmarkData();
    // Ownership of the old shared key is unknown. Copy it only to the guest,
    // retain the source verbatim, and never turn it into public tags.
    if (!owner) {
      data.local = ids(JSON.parse(storage.getItem('petal-bookmarks') || '[]'));
      storage.setItem(key, JSON.stringify(data));
    }
    return data;
  }
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.local) || !Array.isArray(data.hidden)) throw Error('保存データを読み込めません');
  const event = data.event as Event | null;
  return {local: ids(data.local), hidden: ids(data.hidden), event: owner && event?.kind === 10003 && event.pubkey === owner && verified(event) ? event : null};
}
export function bookmarkIds(data: BookmarkData): string[] {
  return [...new Set([...data.local, ...ids(data.event?.tags.filter(t => t[0] === 'e').map(t => t[1]))])].filter(id => !data.hidden.includes(id));
}
export function emptyBookmarkState(owner = ''): BookmarkState {
  return {owner, ready: false, loading: false, partial: false, error: '', data: emptyBookmarkData(), items: []};
}

/** Only REQ/CLOSE are emitted. Bounds cover malformed frames, event floods,
 * hanging relays, duplicate responses, and account/visibility cancellation. */
export async function queryBookmarks(urls: string[], filters: Filter[], signal: AbortSignal, timeout = 8000) {
  if (signal.aborted) throw Error('取得を中止しました');
  const targets = [...new Set(urls.map(normalizeRelay))];
  if (targets.length > 32) throw Error('取得先のリレーが多すぎます');
  const events = new Map<string, Event>();
  const results = await Promise.all(targets.map(url => new Promise<boolean>(resolve => {
    let socket: WebSocket | undefined, settled = false, count = 0, bytes = 0;
    const id = 'bookmarks-' + Math.random().toString(36).slice(2);
    const finish = (complete = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try {if (socket.readyState === 1) socket.send(JSON.stringify(['CLOSE', id])); socket.close();} catch { /* closed */ }
      }
      resolve(complete);
    };
    const abort = () => finish();
    const timer = setTimeout(finish, Math.max(1, Math.min(timeout, 8000)));
    signal.addEventListener('abort', abort, {once: true});
    try {socket = new WebSocket(url);} catch {finish(); return;}
    socket.onopen = () => {try {socket!.send(JSON.stringify(['REQ', id, ...filters]));} catch {finish();}};
    socket.onerror = socket.onclose = () => finish();
    socket.onmessage = message => {
      const frame = parseRelayFrame(message.data);
      if (!frame) {finish(); return;}
      if (frame[1] !== id) return;
      if (frame[0] === 'EOSE') {finish(true); return;}
      if (frame[0] === 'CLOSED') {finish(); return;}
      if (frame[0] !== 'EVENT') return;
      if (++count > 500 || (bytes += message.data.length) > 2_000_000) {finish(); return;}
      const event = frame[2] as Event;
      if (!verified(event) || !filters.some(f =>
        (!f.kinds || f.kinds.includes(event.kind)) && (!f.ids || f.ids.includes(event.id)) &&
        (!f.authors || f.authors.includes(event.pubkey)) &&
        (!f['#e'] || event.tags.some(t => t[0] === 'e' && f['#e']!.includes(t[1]))))) {finish(); return;}
      events.set(event.id, event);
    };
  })));
  if (signal.aborted) throw Error('取得を中止しました');
  return {events: [...events.values()], partial: !targets.length || results.some(ok => !ok)};
}

export class BookmarkSession {
  state = emptyBookmarkState();
  private request?: AbortController;
  private urls: string[] = [];
  private cursor = 0;
  constructor(private storage: StorageAccess, private changed: (state: BookmarkState) => void, private query = queryBookmarks) {}
  private emit() {this.changed({...this.state});}
  start(owner: string, urls: string[]) {
    this.stop(); this.urls = urls; this.cursor = 0; this.state = emptyBookmarkState(owner);
    try {this.state.data = readBookmarks(this.storage, owner); this.state.ready = true;}
    catch {this.state.error = '保存データを読み込めません。再試行してください';}
    this.reconcile(); this.emit();
  }
  stop() {this.request?.abort(); this.request = undefined;}
  private reconcile() {
    const known = new Map(this.state.items.map(item => [item.id, item]));
    this.state.items = bookmarkIds(this.state.data).map(id => known.get(id) ?? {id, status: 'pending'});
  }
  private persist(data: BookmarkData, keepStoredLocal = false) {
    // Another tab may have saved since this tab's last storage event.
    const stored = readBookmarks(this.storage, this.state.owner);
    const event = stored.event && isLatestReplaceable(data.event, stored.event) ? stored.event : data.event;
    const next = {...(keepStoredLocal ? stored : data), event};
    this.storage.setItem(bookmarkKey(this.state.owner), JSON.stringify(next));
    this.state.data = next;
  }
  toggle(id: string) {
    if (!this.state.ready || !hex.test(id)) return false;
    const saved = bookmarkIds(this.state.data).includes(id);
    try {
      const stored = readBookmarks(this.storage, this.state.owner);
      const next = {...stored, event: this.state.data.event, local: stored.local.filter(value => value !== id), hidden: stored.hidden.filter(value => value !== id)};
      if (saved) next.hidden.push(id); else next.local.push(id);
      this.persist(next); this.state.error = ''; this.reconcile(); this.emit(); return true;
    } catch {this.state.error = 'この端末に保存できませんでした'; this.emit(); return false;}
  }
  async refresh() {
    if (this.request || !this.state.ready) return;
    const request = new AbortController(); this.request = request;
    const current = () => this.request === request && !request.signal.aborted;
    this.state.loading = true; this.state.partial = false; this.state.error = ''; this.emit();
    try {
      if (this.state.owner) {
        const result = await this.query(this.urls, [{kinds: [10003], authors: [this.state.owner], limit: 1}], request.signal);
        if (!current()) return;
        let latest = this.state.data.event;
        for (const event of result.events) if (isLatestReplaceable(latest, event)) latest = event;
        // Keep the complete signed event, including unknown tags and ciphertext.
        if (latest !== this.state.data.event) {
          const data = {...this.state.data, event: latest};
          try {this.persist(data, true); latest = this.state.data.event;} catch {this.state.data = data; this.state.error = '同期結果をこの端末に保存できませんでした';}
        }
        this.state.partial = result.partial || !!latest && !result.events.some(e => e.id === latest.id);
        this.reconcile(); this.emit();
      }
      // Explicit IDs resolve old bookmarks independently of the home timeline.
      // A bounded page avoids an unbounded request for legacy lists of any size.
      const ordered = [...this.state.items.slice(this.cursor), ...this.state.items.slice(0, this.cursor)];
      const page = [...ordered.filter(item => item.status === 'pending'), ...ordered.filter(item => item.status !== 'pending')].slice(0, 500);
      this.cursor = this.state.items.length ? (this.cursor + page.length) % this.state.items.length : 0;
      for (let offset = 0; offset < page.length; offset += 50) {
        const batch = page.slice(offset, offset + 50), selected = batch.map(item => item.id);
        const result = await this.query(this.urls, [{kinds: [1], ids: selected}, {kinds: [5], '#e': selected}], request.signal);
        if (!current()) return;
        this.state.partial ||= result.partial;
        const notes = new Map(result.events.filter(e => e.kind === 1).map(e => [e.id, e]));
        const deletions = result.events.filter(e => e.kind === 5);
        this.state.items = this.state.items.map(item => {
          if (!selected.includes(item.id)) return item;
          const event = notes.get(item.id) ?? item.event;
          const deleted = item.status === 'deleted' || event && deletions.some(e => e.pubkey === event.pubkey && e.tags.some(t => t[0] === 'e' && t[1] === event.id));
          return {id: item.id, event, status: deleted ? 'deleted' : event ? 'ready' : result.partial ? 'failed' : 'missing'};
        });
        this.emit();
      }
      if (this.state.items.some(item => item.status === 'pending') && !this.state.error) this.state.error = '未取得の投稿があります。再取得で続きを読み込みます';
    } catch {if (current()) {this.state.partial = true; this.state.error = '取得に失敗しました。再試行してください';}}
    finally {if (current()) {this.request = undefined; this.state.loading = false; this.emit();}}
  }
}
