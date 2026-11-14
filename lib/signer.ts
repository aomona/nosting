import {verifyEvent, type Event, type EventTemplate} from 'nostr-tools';

/** Both NIP-07 and NIP-46 expose the same operations to the application. */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<Event>;
  nip44?: {
    encrypt(pubkey: string, text: string): Promise<string>;
    decrypt(pubkey: string, text: string): Promise<string>;
  };
  close?(): void;
}
export const validSignerKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function verifiedSignature(event: Event, template: EventTemplate, owner: string): Event {
  event = structuredClone(event); // Discard nostr-tools' cached verification symbol at the trust boundary.
  if (event.pubkey !== owner || event.kind !== template.kind || event.created_at !== template.created_at ||
      event.content !== template.content || JSON.stringify(event.tags) !== JSON.stringify(template.tags) || !verifyEvent(event)) {
    throw Error('署名を確認できませんでした');
  }
  return event;
}

/** No keys or connection tokens are persisted. Epochs also protect same-account reconnects. */
export class SignerSession {
  private signer: Signer | null = null;
  private owner = '';
  private epoch = 0;
  clear() {
    this.epoch++;
    this.signer?.close?.();
    this.signer = null;
    this.owner = '';
  }
  async connect(signer: Signer) {
    this.clear();
    const epoch = this.epoch;
    this.signer = signer;
    try {
      const key = await signer.getPublicKey();
      if (epoch !== this.epoch) throw Error('接続を中止しました');
      if (!validSignerKey(key)) throw Error('公開鍵が不正です');
      this.owner = key;
      return key;
    } catch (error) {
      if (epoch === this.epoch) this.clear();
      throw error;
    }
  }
  /** Bound adapters never fall back to a different extension/account after logout. */
  accountSigner(owner: string): Signer | undefined {
    const signer = this.signer, epoch = this.epoch;
    if (!signer || !owner || owner !== this.owner) return undefined;
    const check = () => {if (epoch !== this.epoch || this.owner !== owner) throw Error('ログイン状態が変わりました');};
    const guard = async <T>(operation: () => Promise<T>): Promise<T> => {
      check(); const result = await operation(); check(); return result;
    };
    return {
      getPublicKey: () => guard(async () => {
        const key = await signer.getPublicKey();
        if (key !== owner) throw Error('ログイン状態が変わりました');
        return key;
      }),
      signEvent: event => guard(() => this.signEvent(event, owner)),
      ...(signer.nip44 ? {nip44: {
        encrypt: (key: string, text: string) => guard(() => signer.nip44!.encrypt(key, text)),
        decrypt: (key: string, text: string) => guard(() => signer.nip44!.decrypt(key, text)),
      }} : {}),
    };
  }
  async signEvent(template: EventTemplate, owner: string) {
    const signer = this.signer, epoch = this.epoch;
    if (!signer || !owner || owner !== this.owner) throw Error('ログインしてください');
    // Isolate caller and extension mutations from the expected payload.
    const expected = structuredClone(template);
    const event = await signer.signEvent(structuredClone(expected));
    if (epoch !== this.epoch) throw Error('ログイン状態が変わりました');
    return verifiedSignature(event, expected, owner);
  }
}
