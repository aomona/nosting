import {finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent, type Event, type EventTemplate} from 'nostr-tools';
import {validSignerKey, verifiedSignature, type Signer} from './signer';

export type SignerAuthorization = {url: string; cancel: () => void} | null;
export type Bunker = {pubkey: string; relays: string[]; secret: string};
const invalid = () => Error('有効な bunker:// 接続URLを入力してください');
function relayUrl(value: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'wss:' || url.protocol === 'ws:' && local) || url.username || url.password || url.hash) throw invalid();
  return url.href;
}
export function parseBunker(value: string): Bunker {
  try {
    if (value.length > 8192) throw invalid();
    const url = new URL(value.trim());
    if (url.protocol !== 'bunker:' || !validSignerKey(url.hostname) || url.username || url.password || url.port || url.hash || url.pathname && url.pathname !== '/') throw invalid();
    const relays = [...new Set(url.searchParams.getAll('relay').map(relayUrl))];
    if (!relays.length || relays.length > 5) throw invalid();
    return {pubkey: url.hostname, relays, secret: url.searchParams.get('secret') ?? ''};
  } catch { throw invalid(); }
}

type Pending = {event: Event; sent: Set<string>; resolve: (value: string) => void; reject: (error: Error) => void};
type Options = {timeoutMs?: number; socket?: (url: string) => WebSocket; authorization?: (value: SignerAuthorization) => void};

/** NIP-46 bunker + NIP-44 v2. The client key is disposable and never the user's key. */
export class RemoteSigner implements Signer {
  private secretKey = generateSecretKey();
  private clientKey = getPublicKey(this.secretKey);
  private conversationKey: Uint8Array;
  private sockets = new Map<string, WebSocket>();
  private pending = new Map<string, Pending>();
  private subscription = crypto.randomUUID();
  private closed = false;
  private userKey = '';
  private connecting: Promise<string> | null = null;
  private relays: string[];
  constructor(private bunker: Bunker, private options: Options = {}) {
    this.relays = bunker.relays;
    this.conversationKey = nip44.v2.utils.getConversationKey(this.secretKey, bunker.pubkey);
  }
  private send(ws: WebSocket, data: unknown) {
    try { ws.send(JSON.stringify(data)); return true; } catch { return false; }
  }
  private publish(url: string, ws: WebSocket, pending: Pending) {
    if (ws.readyState !== 1 || pending.sent.has(url)) return;
    if (this.send(ws, ['EVENT', pending.event])) pending.sent.add(url);
  }
  private ensureConnections() {
    for (const url of this.relays) {
      const existing = this.sockets.get(url);
      if (existing && existing.readyState < 2) continue;
      try {
        const ws = (this.options.socket ?? (url => new WebSocket(url)))(url);
        this.sockets.set(url, ws);
        const current = () => !this.closed && this.sockets.get(url) === ws;
        ws.onopen = () => {
          if (!current()) return;
          // Subscribe before publishing; synchronous/local responses cannot be lost.
          if (!this.send(ws, ['REQ', this.subscription, {kinds: [24133], authors: [this.bunker.pubkey], '#p': [this.clientKey], since: Math.floor(Date.now() / 1000) - 60}])) return;
          for (const pending of this.pending.values()) this.publish(url, ws, pending);
        };
        ws.onmessage = message => { if (current()) this.receive(message.data); };
        ws.onerror = () => { if (current()) ws.close(); };
      } catch { /* Other relays can still succeed. Each request has a deadline. */ }
    }
  }
  private receive(raw: unknown) {
    try {
      if (typeof raw !== 'string' || raw.length > 200_000) return;
      const frame = JSON.parse(raw);
      if (frame[0] !== 'EVENT' || frame[1] !== this.subscription) return;
      const event: Event = frame[2];
      if (event.kind !== 24133 || event.pubkey !== this.bunker.pubkey || !event.tags.some(t => t[0] === 'p' && t[1] === this.clientKey) || !verifyEvent(event)) return;
      const response = JSON.parse(nip44.v2.decrypt(event.content, this.conversationKey));
      const pending = this.pending.get(response.id);
      if (!pending) return;
      if (response.result === 'auth_url') {
        const url = new URL(response.error);
        if (url.protocol !== 'https:' || url.username || url.password) {
          pending.reject(Error('署名サービスの認証URLが不正です')); return;
        }
        this.options.authorization?.({url: url.href, cancel: () => pending.reject(new DOMException('署名を中止しました', 'AbortError'))});
      } else if (response.error !== undefined && response.error !== null) {
        pending.reject(Error('署名サービスが操作を拒否しました'));
      } else if (typeof response.result === 'string') pending.resolve(response.result);
    } catch { /* Ignore malformed, forged, or undecryptable responses. */ }
  }
  private request(method: string, params: string[]): Promise<string> {
    if (this.closed) return Promise.reject(Error('接続が終了しました。ログインし直してください'));
    if (this.pending.size) return Promise.reject(Error('署名サービスで進行中の操作を完了してください'));
    const id = crypto.randomUUID();
    const event = finalizeEvent({kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', this.bunker.pubkey]],
      content: nip44.v2.encrypt(JSON.stringify({id, method, params}), this.conversationKey)}, this.secretKey);
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: string) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        this.options.authorization?.(null);
        if (error) reject(error); else resolve(value!);
      };
      const timer = setTimeout(() => finish(Error('署名サービスが応答しません。再試行してください')), this.options.timeoutMs ?? 60_000);
      const pending: Pending = {event, sent: new Set(), resolve: value => finish(undefined, value), reject: error => finish(error)};
      this.pending.set(id, pending);
      this.ensureConnections();
      for (const [url, ws] of this.sockets) this.publish(url, ws, pending);
    });
  }
  getPublicKey(): Promise<string> {
    if (this.closed) return Promise.reject(Error('接続が終了しました'));
    if (this.userKey) return Promise.resolve(this.userKey);
    if (!this.connecting) this.connecting = this.connect();
    return this.connecting;
  }
  private async connect() {
    try {
      const response = await this.request('connect', [this.bunker.pubkey, this.bunker.secret, '', JSON.stringify({name: 'nost.ing', url: 'https://nost.ing'})]);
      if (response !== 'ack' && (!this.bunker.secret || response !== this.bunker.secret)) throw Error('接続応答が不正です');
      this.bunker.secret = '';
      // Transport identity is not the account identity.
      const userKey = await this.request('get_public_key', []);
      if (!validSignerKey(userKey)) throw Error('公開鍵が不正です');
      // Older signers may not implement switch_relays. A refusal/timeout leaves the known relays usable.
      const switched = await this.request('switch_relays', []).catch(error => {if (error.name === 'AbortError') throw error; return 'null';});
      if (this.closed) throw Error('接続を中止しました');
      try {
        const values: unknown = JSON.parse(switched);
        if (Array.isArray(values) && values.length > 0 && values.length <= 5 && values.every(v => typeof v === 'string')) {
          const relays = [...new Set(values.map(relayUrl))];
          for (const ws of this.sockets.values()) { ws.onmessage = null; ws.close(); }
          this.sockets.clear(); this.relays = relays;
        }
      } catch { /* Keep the original usable relay set. */ }
      this.userKey = userKey;
      return userKey;
    } catch (error) { this.close(); throw error; }
  }
  async signEvent(template: EventTemplate): Promise<Event> {
    const owner = await this.getPublicKey();
    const expected = structuredClone(template);
    const result = await this.request('sign_event', [JSON.stringify({kind: expected.kind, content: expected.content, tags: expected.tags, created_at: expected.created_at})]);
    return verifiedSignature(JSON.parse(result), expected, owner);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(Error('接続を中止しました'));
    for (const ws of this.sockets.values()) {
      ws.onopen = ws.onmessage = ws.onerror = null;
      if (ws.readyState === 1) this.send(ws, ['CLOSE', this.subscription]);
      ws.close();
    }
    this.sockets.clear();
    this.secretKey.fill(0); this.conversationKey.fill(0);
    this.bunker.secret = ''; this.userKey = '';
    this.options.authorization?.(null);
  }
}
