import {verifyEvent, type Event, type EventTemplate} from 'nostr-tools';

export type RelayAuthStatus = 'available' | 'required' | 'signing' | 'waiting' | 'authenticated' | 'restricted' | 'signing-rejected' | 'rejected' | 'invalid' | 'stale' | 'account-changed' | 'cancelled' | 'timeout' | 'exhausted';
export type RelayAuthState = {status: RelayAuthStatus; canAuthenticate: boolean};
export type RelayAuthRequest = {owner: string; currentOwner: () => string; sign: (event: EventTemplate) => Promise<Event>; signal: AbortSignal};
type Operation = {frame: unknown[]; waiting: boolean; retried: boolean; timer?: ReturnType<typeof setTimeout>};
const MAX_OPERATIONS = 128, MAX_ATTEMPTS = 3;

/** One instance per socket. Challenges never trigger signing without a user action. */
export class RelayAuthentication {
  private challenge?: string;
  private attempted?: string;
  private attempts = 0;
  private version = 0;
  private disposed = false;
  private status: RelayAuthStatus = 'available';
  private pendingId?: string;
  private request?: RelayAuthRequest;
  private release?: () => void;
  private requests = new Map<string, Operation>();
  private writes = new Map<string, Operation>();
  constructor(private url: string, private send: (frame: unknown[]) => void, private terminal: (frame: unknown[]) => void, private changed: (state: RelayAuthState) => void, private timeout = 15000) {}

  private update(status: RelayAuthStatus) {
    this.status = status;
    this.changed({status, canAuthenticate: !!this.challenge && this.challenge !== this.attempted && this.attempts < MAX_ATTEMPTS && !this.disposed && status !== 'restricted' && status !== 'exhausted'});
  }
  private invalidate() {this.version++; this.pendingId = undefined; this.release?.(); this.release = undefined;}
  private fail(status: RelayAuthStatus) {
    this.invalidate(); this.update(status);
    for (const [id, op] of [...this.requests]) if (op.waiting) {this.requests.delete(id); this.terminal(['CLOSED', id, `${status}: authentication stopped`]);}
    for (const [id, op] of [...this.writes]) if (op.waiting) {this.forgetWrite(id); this.terminal(['OK', id, false, `${status}: authentication stopped`]);}
  }
  cancel() {if (this.status === 'signing' || this.status === 'waiting') this.fail('cancelled');}
  dispose() {
    this.disposed = true; this.invalidate(); this.challenge = undefined; this.request = undefined;
    this.requests.clear(); for (const id of this.writes.keys()) this.forgetWrite(id);
  }
  forgetWrite(id: string) {clearTimeout(this.writes.get(id)?.timer); this.writes.delete(id);}
  blocked(id: string) {return !!this.requests.get(id)?.waiting;}
  outgoing(frame: unknown[]) {
    const id = frame[1];
    if (frame[0] === 'REQ' && typeof id === 'string') {
      if (this.requests.has(id) || this.requests.size < MAX_OPERATIONS) this.requests.set(id, {frame, waiting: false, retried: false});
    } else if (frame[0] === 'CLOSE' && typeof id === 'string') this.requests.delete(id);
    else if (frame[0] === 'EVENT' && id && typeof id === 'object' && 'id' in id && typeof id.id === 'string') {
      if (this.writes.has(id.id) || this.writes.size >= MAX_OPERATIONS) return;
      const eventId = id.id;
      // Publisher completion/cancellation normally removes this earlier. Direct sends are bounded too.
      const timer = setTimeout(() => this.forgetWrite(eventId), this.timeout);
      this.writes.set(eventId, {frame, waiting: false, retried: false, timer});
    }
  }
  private retry(op: Operation) {
    const id = op.frame[0] === 'REQ' ? op.frame[1] : (op.frame[1] as Event).id;
    if ((op.frame[0] === 'REQ' ? this.requests : this.writes).get(id as string) !== op) return;
    if (!this.request || this.request.currentOwner() !== this.request.owner) {this.fail('account-changed'); return;}
    op.waiting = false; op.retried = true;
    try {this.send(op.frame);} catch {op.waiting = true; this.fail('rejected');}
  }
  /** true means consumed: callers must not settle jobs on provisional auth-required replies. */
  receive(frame: unknown[]): boolean {
    const [type, id, ok, message] = frame;
    if (type === 'AUTH') {
      if (frame.length !== 2 || typeof id !== 'string' || !id.length || id.length > 256) return true;
      if (id === this.challenge) return true;
      const stale = this.status === 'signing' || this.status === 'waiting';
      this.invalidate(); this.challenge = id; this.request = undefined;
      this.update(this.attempts >= MAX_ATTEMPTS ? 'exhausted' : stale ? 'stale' : [...this.requests.values(), ...this.writes.values()].some(op => op.waiting) ? 'required' : 'available');
      return true;
    }
    if (type === 'OK' && id === this.pendingId) {
      if (frame.length !== 4 || typeof ok !== 'boolean' || typeof message !== 'string') return true;
      if (this.request?.currentOwner() !== this.request?.owner) {this.fail('account-changed'); return true;}
      if (!ok) {this.fail(message.startsWith('restricted:') ? 'restricted' : 'rejected'); return true;}
      this.invalidate(); this.update('authenticated');
      for (const op of [...this.requests.values(), ...this.writes.values()]) if (op.waiting) this.retry(op);
      return true;
    }
    if (typeof id !== 'string' || type !== 'CLOSED' && type !== 'OK') return false;
    if (type === 'CLOSED' && frame.length !== 3 || type === 'OK' && frame.length !== 4) return true;
    const reason = type === 'CLOSED' ? ok : message;
    if (typeof reason !== 'string' || type === 'OK' && typeof ok !== 'boolean') return false;
    const operations = type === 'CLOSED' ? this.requests : this.writes, op = operations.get(id);
    if (!op) return false;
    if ((type === 'CLOSED' || ok === false) && reason.startsWith('auth-required:') && !op.retried && !['restricted','signing-rejected','rejected','invalid','cancelled','timeout','account-changed','exhausted'].includes(this.status)) {
      op.waiting = true;
      if (this.status === 'authenticated') this.retry(op);
      else if (this.status !== 'signing' && this.status !== 'waiting') this.update('required');
      return true;
    }
    if (reason.startsWith('restricted:')) this.update('restricted');
    else if (reason.startsWith('auth-required:') && op.retried) this.update('exhausted');
    if (type === 'OK') this.forgetWrite(id); else this.requests.delete(id);
    return false;
  }
  async authenticate(request: RelayAuthRequest) {
    if (this.disposed || this.status === 'restricted' || !this.challenge || this.challenge === this.attempted || this.attempts >= MAX_ATTEMPTS || request.signal.aborted || !/^[a-f0-9]{64}$/.test(request.owner)) return;
    if (request.currentOwner() !== request.owner) {this.fail('account-changed'); return;}
    const challenge = this.challenge, version = ++this.version;
    this.attempted = challenge; this.attempts++; this.request = request; this.update('signing');
    const abort = () => this.fail('cancelled');
    const timer = setTimeout(() => this.fail('timeout'), this.timeout);
    request.signal.addEventListener('abort', abort, {once: true});
    this.release = () => {clearTimeout(timer); request.signal.removeEventListener('abort', abort);};
    const unsigned: EventTemplate = {kind: 22242, created_at: Math.floor(Date.now()/1000), tags: [['relay', this.url], ['challenge', challenge]], content: ''};
    const expected = JSON.stringify(unsigned);
    let signing = true;
    try {
      const signed = await request.sign(unsigned);
      signing = false;
      if (this.disposed || version !== this.version) return;
      if (request.currentOwner() !== request.owner) {this.fail('account-changed'); return;}
      // Copy strips nostr-tools' cached verification symbol and any signer-owned references.
      const event = JSON.parse(JSON.stringify(signed)) as Event;
      if (event.pubkey !== request.owner || JSON.stringify({kind: event.kind, created_at: event.created_at, tags: event.tags, content: event.content}) !== expected || !verifyEvent(event)) {this.fail('invalid'); return;}
      this.pendingId = event.id; this.update('waiting'); this.send(['AUTH', event]);
    } catch {if (!this.disposed && version === this.version) this.fail(signing ? 'signing-rejected' : this.status === 'waiting' ? 'rejected' : 'invalid');}
  }
}
