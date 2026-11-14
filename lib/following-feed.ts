import {verifyEvent, type Event, type Filter} from 'nostr-tools';
import {normalizeRelay} from './relays';
import {parseRelayFrame, validInboundEvent, matchesRelayFilter} from './relay-connections';
import {parseRelayList} from './relay-discovery';
import {isLatestReplaceable} from './latest-event';
import {advanceCursor} from './history-pager';
import {FEED_LIMIT, retainFeed} from './feed-retention';
import {TimelineReposts} from './timeline-reposts';
import {QuoteResolver} from './quotes';

// These limits apply to this timeline's additional, read-only connections.
export const FOLLOWING_RELAY_LIMIT = 6;
export const FOLLOWING_DISCOVERY_LIMIT = 3;
const AUTHOR_BATCH = 200;
const AUTHOR_LIMIT = 20000;
type Cursor = Parameters<typeof advanceCursor>[0];
type Page = {events: Event[]; complete: boolean};
type Subscription = {filter: Filter; receive: (event: Event) => void; finish: (complete: boolean) => void};
type Options = {socket?: (url: string) => WebSocket; timeout?: number; now?: () => number};
export type FollowingSnapshot = {
  events: Event[]; originals: Record<string, Event>; loading: boolean;
  initial: boolean; failed: number; partial: boolean; done: boolean; limited: boolean;
};
export const emptyFollowing: FollowingSnapshot = {
  events: [], originals: {}, loading: false, initial: true,
  failed: 0, partial: false, done: false, limited: false,
};
let sequence = 0;

/** One bounded connection; every inbound event is matched and signature verified. */
class Reader {
  socket?: WebSocket;
  private subscriptions = new Map<string, Subscription>();
  private stopped = false;
  private opened: Promise<boolean>;
  private finishOpen: (ok: boolean) => void = () => {};
  private deadline: ReturnType<typeof setTimeout>;
  constructor(readonly url: string, private options: Options, private disconnected: () => void) {
    this.opened = new Promise(resolve => { this.finishOpen = resolve; });
    this.deadline = setTimeout(() => this.fail(), options.timeout ?? 8000);
    try {
      const socket = this.socket = (options.socket ?? (url => new WebSocket(url)))(url);
      socket.onopen = () => { if (!this.stopped) { clearTimeout(this.deadline); this.finishOpen(true); } };
      socket.onerror = socket.onclose = () => this.fail();
      socket.onmessage = message => {
        if (this.stopped) return;
        const frame = parseRelayFrame(message.data);
        if (!frame) return;
        const sub = this.subscriptions.get(String(frame[1]));
        if (!sub) return;
        if (frame[0] === 'EOSE' || frame[0] === 'CLOSED') sub.finish(frame[0] === 'EOSE');
        if (frame[0] !== 'EVENT') return;
        const event = frame[2] as Event;
        try {
          if (validInboundEvent(event) && matchesRelayFilter(event, sub.filter) && verifyEvent(event)) sub.receive(event);
        } catch { /* Ignore malformed or invalid events without poisoning the page. */ }
      };
    } catch { this.fail(); }
  }
  private fail() {
    if (this.stopped) return;
    this.stop();
    this.disconnected();
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.deadline);
    this.finishOpen(false);
    for (const sub of [...this.subscriptions.values()]) sub.finish(false);
    this.subscriptions.clear();
    try { this.socket?.close(); } catch {}
  }
  async query(filter: Filter, receive?: (event: Event) => void, live = false): Promise<Page> {
    if (!await this.opened || this.stopped) return {events: [], complete: false};
    return new Promise(resolve => {
      const id = 'following-' + (++sequence), events = new Map<string, Event>();
      let settled = false;
      const close = () => {
        this.subscriptions.delete(id);
        try { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(['CLOSE', id])); } catch {}
      };
      const finish = (complete: boolean) => {
        clearTimeout(timer);
        if (!live || !complete) close();
        if (!settled) { settled = true; resolve({events: [...events.values()], complete}); }
        if (live && !complete) this.disconnected();
      };
      const timer = setTimeout(() => finish(false), this.options.timeout ?? 8000);
      this.subscriptions.set(id, {filter, finish, receive: event => {
        if (!live && !events.has(event.id) && events.size >= (filter.limit ?? AUTHOR_BATCH)) { finish(false); return; }
        if (!live) events.set(event.id, event);
        receive?.(event);
      }});
      try { this.socket!.send(JSON.stringify(['REQ', id, filter])); } catch { finish(false); }
    });
  }
  /** QuoteResolver owns its own subscription IDs and validation. */
  attachQuotes(quotes: QuoteResolver) {
    const previous = this.socket?.onmessage;
    if (this.socket) this.socket.onmessage = message => {
      if (this.stopped) return;
      const frame = parseRelayFrame(message.data);
      if (frame && String(frame[1]).startsWith('quote-')) {
        if (frame[0] !== 'EVENT' || validInboundEvent(frame[2])) quotes.receive(this.url, frame);
      } else previous?.call(this.socket!, message);
    };
  }
}

function relayUrls(values: string[]) {
  return [...new Set(values.flatMap(value => { try { return [normalizeRelay(value)]; } catch { return []; } }))];
}

/** Prefer outboxes covering many followed authors; keep one fallback for missing metadata.
 * Unselected outboxes are explicit partial coverage, never an unbounded socket fan-out. */
export function followingRoutes(authors: string[], lists: Map<string, Event>, fallback: string[]) {
  const candidates = new Map<string, Set<string>>();
  for (const author of authors) for (const relay of lists.has(author) ? parseRelayList(lists.get(author)!).filter(r => r.write) : []) {
    if (!candidates.has(relay.url)) candidates.set(relay.url, new Set());
    candidates.get(relay.url)!.add(author);
  }
  const selected = new Map<string, string[]>();
  if (fallback[0]) selected.set(fallback[0], authors);
  const ranked = [...candidates].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  for (const [url, keys] of ranked) {
    if (selected.has(url)) continue;
    if (selected.size >= FOLLOWING_RELAY_LIMIT) break;
    selected.set(url, [...keys]);
  }
  return {routes: selected, partial: [...candidates.keys()].some(url => !selected.has(url))};
}

/** Owned by one account/follow-set/tab lifetime. No publishing or persistent relay settings. */
export function createFollowingFeed(authorsInput: string[], readRelays: string[], update: (s: FollowingSnapshot) => void, options: Options = {}) {
  const allAuthors = [...new Set(authorsInput.filter(key => /^[a-f0-9]{64}$/.test(key)))].sort();
  const authors = allAuthors.slice(0, AUTHOR_LIMIT), fallback = relayUrls(readRelays).slice(0, FOLLOWING_DISCOVERY_LIMIT);
  let alive = true, loading = true, initial = true, partial = allAuthors.length > AUTHOR_LIMIT;
  let events: Event[] = [], originals: Record<string, Event> = {};
  const readers = new Map<string, Reader>(), cursors = new Map<string, Cursor>(), failed = new Set<string>();
  const lists = new Map<string, Event>();
  let routes = new Map<string, string[]>();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000)), ceiling = now();
  let batch: ReturnType<typeof setTimeout> | undefined;
  const quotes = new QuoteResolver(() => [...readers.values()].flatMap(r => r.socket ? [r.socket] : []), () => [...routes.keys()], options.timeout);
  const reposts = new TimelineReposts(id => quotes.request(id), (repost, original) => {
    if (!alive) return;
    originals = {...originals, [repost.id]: original}; schedule();
  });
  function emit() {
    if (alive) update({events, originals, loading, initial, failed: failed.size, partial,
      done: !routes.size || [...routes.keys()].every(url => cursors.get(url)?.done), limited: events.length >= FEED_LIMIT});
  }
  function schedule() { if (alive && !batch) batch = setTimeout(() => { batch = undefined; emit(); }, 50); }
  function collect(event: Event) {
    if (!alive || events.length >= FEED_LIMIT) return;
    events = retainFeed(events, [event]);
    if (event.kind === 6) reposts.add(event);
    schedule();
    if (events.length >= FEED_LIMIT) { quotes.reset(); for (const reader of readers.values()) reader.stop(); }
  }
  function reader(url: string) {
    const r = new Reader(url, options, () => { if (alive) { failed.add(url); quotes.disconnect(url); schedule(); } });
    readers.set(url, r); return r;
  }
  async function page(retry = false) {
    if (!alive || loading || events.length >= FEED_LIMIT) return;
    loading = true; emit();
    const targets = [...routes].filter(([url]) => retry ? failed.has(url) : !failed.has(url) && !cursors.get(url)?.done);
    await Promise.all(targets.map(async ([url, keys]) => {
      if (retry) { readers.get(url)?.stop(); failed.delete(url); const r = reader(url); r.attachQuotes(quotes); live(r, keys); }
      const cursor = cursors.get(url) ?? {until: ceiling, limit: 50, done: false, started: true};
      const result = await readers.get(url)!.query({kinds: [1, 6], authors: keys, until: cursor.until, limit: cursor.limit}, collect);
      if (!alive) return;
      if (!result.complete) { failed.add(url); return; }
      try { cursors.set(url, advanceCursor(cursor, result.events)); } catch { failed.add(url); }
    }));
    if (!alive) return;
    loading = false; initial = false; reposts.retry(); emit();
  }
  function live(r: Reader, keys: string[]) {
    // Separate live window: new arrivals cannot move the history cursor.
    void r.query({kinds: [1, 6], authors: keys, since: ceiling, limit: 50}, collect, true);
  }
  async function start() {
    emit();
    if (!authors.length) { loading = false; initial = false; emit(); return; }
    // Discovery has at most three concurrent queries, with 200 authors per batch.
    await Promise.all(fallback.map(async url => {
      const r = reader(url);
      for (let i = 0; alive && i < authors.length; i += AUTHOR_BATCH) {
        const keys = authors.slice(i, i + AUTHOR_BATCH);
        const result = await r.query({kinds: [10002], authors: keys, limit: keys.length}, event => {
          if (isLatestReplaceable(lists.get(event.pubkey) ?? null, event)) lists.set(event.pubkey, event);
        });
        if (!result.complete) { partial = true; break; }
      }
    }));
    if (!alive) return;
    for (const r of readers.values()) r.stop();
    readers.clear(); failed.clear();
    const plan = followingRoutes(authors, lists, fallback); routes = plan.routes; partial ||= plan.partial || !routes.size;
    for (const [url, keys] of routes) { const r = reader(url); r.attachQuotes(quotes); live(r, keys); }
    loading = false;
    await page();
  }
  void start();
  return {
    loadOlder: page,
    stop() { alive = false; clearTimeout(batch); reposts.reset(); quotes.reset(); for (const r of readers.values()) r.stop(); readers.clear(); },
  };
}
