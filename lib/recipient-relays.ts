import {verifyEvent, type Event, type EventTemplate} from 'nostr-tools';
import {isLatestReplaceable} from './latest-event';
import {normalizeRelay} from './relays';
import {parseRelayFrame, validInboundEvent} from './relay-connections';

// Per publication, never persisted into the user's relay settings.
export const RECIPIENT_LIMITS = {people: 16, discovery: 8, perPerson: 4, extraRelays: 16, concurrency: 4};
const keyPattern = /^[a-f0-9]{64}$/;
export function mentionedRecipients(tags: string[][], owner: string): string[] {
  return [...new Set(tags.filter(t => t[0] === 'p' && keyPattern.test(t[1]) && t[1] !== owner).map(t => t[1]))];
}
/** Only explicit public DNS hostnames over TLS; never follow p-tag relay hints. */
export function recipientRelayUrl(raw: string): string {
  if (raw.length > 2048 || !/^wss:\/\//i.test(raw)) throw Error('未対応のリレーURLです');
  const url = normalizeRelay(raw), host = new URL(url).hostname;
  if (host.endsWith('.') || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      host.split('.').some(label => label.length > 63 || label.startsWith('-') || label.endsWith('-')) ||
      /\.(?:localhost|local|localdomain|internal|intranet|lan|home|corp|private|onion|arpa)$/.test(host) ||
      !/[a-z]/.test(host.split('.').at(-1)!)) throw Error('非公開ホストには接続できません');
  return url;
}
function verifiedList(value: unknown, owners: Set<string>): Event | null {
  const event = value as Event;
  try {return validInboundEvent(event) && event.kind === 10002 && owners.has(event.pubkey) && verifyEvent(event) ? event : null;} catch {return null;}
}
function copyEvent(event: Event): Event {
  return {id: event.id, pubkey: event.pubkey, kind: event.kind, created_at: event.created_at,
    content: event.content, tags: event.tags.map(tag => [...tag]), sig: event.sig};
}
export type RecipientDiscovery = {events: Map<string, Event>; partial: boolean};
/** One bounded subscription per discovery relay, with an individual filter per author. */
export async function discoverRecipientRelays(owners: string[], urls: string[], signal: AbortSignal, timeout = 8000): Promise<RecipientDiscovery> {
  const keys = [...new Set(owners)], allowed = new Set(keys), events = new Map<string, Event>();
  if (keys.length > RECIPIENT_LIMITS.people + 1 || keys.some(key => !keyPattern.test(key))) throw Error('宛先が多すぎます');
  const targets = [...new Set(urls.map(normalizeRelay))].slice(0, RECIPIENT_LIMITS.discovery);
  const complete = await Promise.all(targets.map(url => new Promise<boolean>(resolve => {
    let ws: WebSocket | undefined, settled = false, count = 0;
    const id = 'recipient-relays-' + Math.random().toString(36).slice(2);
    const finish = (ok = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (ws) {ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', id])); ws.close();} catch { /* closed */ }}
      resolve(ok);
    };
    const abort = () => finish(), timer = setTimeout(finish, Math.max(1, Math.min(timeout, 8000)));
    if (signal.aborted) {finish(); return;}
    signal.addEventListener('abort', abort, {once: true});
    try {ws = new WebSocket(url);} catch {finish(); return;}
    ws.onopen = () => {if (signal.aborted) {finish(); return;} try {ws!.send(JSON.stringify(['REQ', id, ...keys.map(pubkey => ({kinds: [10002], authors: [pubkey], limit: 1}))]));} catch {finish();}};
    ws.onerror = ws.onclose = () => finish();
    ws.onmessage = message => {
      const frame = parseRelayFrame(message.data);
      if (!frame || ++count > 256) {finish(); return;}
      if (frame[1] !== id) return;
      if (frame[0] === 'EOSE') {finish(true); return;}
      if (frame[0] === 'CLOSED') {finish(); return;}
      if (frame[0] !== 'EVENT') return;
      const event = verifiedList(frame[2], allowed);
      if (!event) {finish(); return;}
      if (isLatestReplaceable(events.get(event.pubkey) ?? null, event)) events.set(event.pubkey, event);
    };
  })));
  if (signal.aborted) throw Error('送信を中止しました');
  return {events, partial: !targets.length || new Set(urls).size > targets.length || complete.some(ok => !ok)};
}
export type RecipientPlan = {targets: string[]; missing: number; limited: boolean};
export function planRecipientDelivery(writeUrls: string[], recipients: string[], lists: Map<string, Event>): RecipientPlan {
  const targets = new Set(writeUrls.map(normalizeRelay));
  if (targets.size > 16) throw Error('投稿先が多すぎます');
  let extra = 0, missing = 0, limited = recipients.length > RECIPIENT_LIMITS.people;
  for (const person of recipients.slice(0, RECIPIENT_LIMITS.people)) {
    const event = lists.get(person);
    if (!event) {missing++; continue;}
    const inboxes = new Set<string>();
    for (const tag of event.tags) {
      if (tag[0] !== 'r' || tag[2] === 'write') continue;
      if (tag.length < 2 || tag.length > 3 || tag[2] !== undefined && tag[2] !== 'read') {limited = true; continue;}
      try {inboxes.add(recipientRelayUrl(tag[1]));} catch {limited = true;}
    }
    if (inboxes.size > RECIPIENT_LIMITS.perPerson) limited = true;
    for (const url of [...inboxes].slice(0, RECIPIENT_LIMITS.perPerson)) {
      if (targets.has(url)) continue;
      if (extra >= RECIPIENT_LIMITS.extraRelays) {limited = true; continue;}
      targets.add(url); extra++;
    }
  }
  return {targets: [...targets], missing, limited};
}
export type DeliveryReceipt = {url: string; note: boolean; metadata: boolean};
/** Wait for both IDs on every target, not just the first positive ACK. */
export async function deliverRecipientNote(note: Event, metadata: Event | null, targets: string[], signal: AbortSignal, timeout = 8000): Promise<DeliveryReceipt[]> {
  if (targets.length > 32 || new Set(targets).size !== targets.length) throw Error('投稿先を確認してください');
  const results: DeliveryReceipt[] = [];
  let cursor = 0;
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 24000);
  const deliverySignal = AbortSignal.any([signal, deadline.signal]);
  try {
    await Promise.all(Array.from({length: Math.min(RECIPIENT_LIMITS.concurrency, targets.length)}, async () => {
      while (cursor < targets.length) {
        const url = targets[cursor++];
        results.push(await new Promise<DeliveryReceipt>(resolve => {
          let ws: WebSocket | undefined, settled = false;
          const replies = new Map<string, boolean>(), ids = [note.id, ...(metadata ? [metadata.id] : [])];
          const finish = () => {
            if (settled) return;
            settled = true; clearTimeout(targetTimer); deliverySignal.removeEventListener('abort', finish);
            if (ws) {ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try {ws.close();} catch { /* closed */ }}
            resolve({url, note: replies.get(note.id) === true, metadata: !!metadata && replies.get(metadata.id) === true});
          };
          const targetTimer = setTimeout(finish, Math.max(1, Math.min(timeout, 8000)));
          if (deliverySignal.aborted) {finish(); return;}
          deliverySignal.addEventListener('abort', finish, {once: true});
          try {ws = new WebSocket(url);} catch {finish(); return;}
          ws.onopen = () => {
            if (deliverySignal.aborted) {finish(); return;}
            try {
              if (metadata) ws!.send(JSON.stringify(['EVENT', metadata]));
              if (!deliverySignal.aborted) ws!.send(JSON.stringify(['EVENT', note]));
            } catch {finish();}
          };
          ws.onerror = ws.onclose = () => finish();
          ws.onmessage = message => {
            const frame = parseRelayFrame(message.data);
            if (frame?.[0] !== 'OK' || !ids.includes(frame[1] as string) || typeof frame[2] !== 'boolean') return;
            if (!replies.has(frame[1] as string)) replies.set(frame[1] as string, frame[2]);
            if (ids.every(id => replies.has(id))) finish();
          };
        }));
      }
    }));
  } finally {clearTimeout(timer);}
  return results;
}
export type RecipientPublication = RecipientPlan & {event: Event; receipts: DeliveryReceipt[]; discoveryPartial: boolean; metadataMissing: boolean};
export async function publishRecipientNote(args: {
  owner: string; unsigned: EventTemplate; ownList: Event | null; writeUrls: string[]; lookupUrls: string[];
  signal: AbortSignal; currentOwner: () => string; sign: (event: EventTemplate) => Promise<Event>; timeout?: number;
}): Promise<RecipientPublication> {
  const check = () => {if (args.signal.aborted) throw Error('送信を中止しました'); if (args.currentOwner() !== args.owner) throw Error('ログイン状態が変わりました');};
  check();
  if (args.unsigned.kind !== 1 || !keyPattern.test(args.owner)) throw Error('公開ノートを確認してください');
  const unsigned = {...args.unsigned, tags: args.unsigned.tags.map(tag => [...tag])};
  const expected = JSON.stringify({kind: unsigned.kind, content: unsigned.content, tags: unsigned.tags, created_at: unsigned.created_at}), people = mentionedRecipients(unsigned.tags, args.owner);
  const discovery = await discoverRecipientRelays([args.owner, ...people.slice(0, RECIPIENT_LIMITS.people)], args.lookupUrls, args.signal, args.timeout);
  check();
  let ownList = discovery.events.get(args.owner) ?? null;
  if (args.ownList) {
    const known = verifiedList(copyEvent(args.ownList), new Set([args.owner]));
    if (known && isLatestReplaceable(ownList, known)) ownList = known;
  }
  const plan = planRecipientDelivery(args.writeUrls, people, discovery.events);
  if (!plan.targets.length) throw Error('投稿先のリレーがありません');
  const returned = await args.sign(unsigned); check();
  const event = copyEvent(returned);
  if (event.pubkey !== args.owner || JSON.stringify({kind: event.kind, content: event.content, tags: event.tags, created_at: event.created_at}) !==
      expected || !verifyEvent(event)) throw Error('署名を確認できませんでした');
  const receipts = await deliverRecipientNote(event, ownList, plan.targets, args.signal, args.timeout);
  check();
  return {...plan, event, receipts, discoveryPartial: discovery.partial, metadataMissing: !ownList};
}
export function recipientPublicationMessage(result: RecipientPublication): string {
  const confirmed = result.receipts.filter(r => r.note).length;
  if (!confirmed) return '受信確認が取れません。再投稿前にタイムラインを確認してください';
  const warnings = [result.missing ? `宛先一覧未発見 ${result.missing}人` : '', result.discoveryPartial ? '宛先取得は一部未確認' : '',
    result.limited ? '一部の宛先を省略' : '', result.metadataMissing ? '自分のリレー一覧なし' :
      result.receipts.some(r => !r.metadata) ? 'リレー一覧の共有は一部未確認' : ''].filter(Boolean);
  return [`${confirmed}/${result.targets.length}リレーで投稿を確認`, ...warnings].join('。');
}
