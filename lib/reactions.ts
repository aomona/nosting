import {verifyEvent, type Event, type EventTemplate} from 'nostr-tools';
import {emojiMap} from './custom-emoji';
import {validInboundEvent} from './relay-connections';

export type ReactionTarget = Pick<Event, 'id' | 'pubkey' | 'kind'>;
export type ReactionChoice = {content:string; emoji?:{code:string; url:string}};
const hex = (s:string) => /^[a-f0-9]{64}$/.test(s);
const lastTag = (event:Event, name:string) => event.tags.filter(t => t[0] === name).at(-1)?.[1];
export function verifiedReactionEvent(event:Event, owner:string):boolean {
  try {
    // Never trust nostr-tools' verification cache on an object supplied by a signer.
    return event.pubkey === owner && validInboundEvent(event) && verifyEvent({
      id:event.id, pubkey:event.pubkey, kind:event.kind, created_at:event.created_at,
      content:event.content, tags:event.tags, sig:event.sig,
    });
  } catch { return false; }
}
export function reactionMatches(event:Event, owner:string, target:ReactionTarget):boolean {
  return event.kind === 7 && event.content.length <= 256 && event.tags.length <= 100 && verifiedReactionEvent(event, owner) &&
    lastTag(event, 'e') === target.id && lastTag(event, 'p') === target.pubkey &&
    (!lastTag(event, 'k') || lastTag(event, 'k') === String(target.kind));
}
export function reactionKey(event:Pick<Event,'content'|'tags'>):string {
  if (event.content === '' || event.content === '+') return '+';
  const code = /^:([A-Za-z0-9_-]{1,64}):$/.exec(event.content)?.[1];
  return code ? `${event.content}|${emojiMap(event.tags)[code] ?? ''}` : event.content;
}
export function reactionTemplate(target:ReactionTarget, choice:ReactionChoice, now=Math.floor(Date.now()/1000)):EventTemplate {
  if (!hex(target.id) || !hex(target.pubkey) || !Number.isSafeInteger(target.kind)) throw Error('投稿を確認できません');
  const tags = [['e', target.id, '', target.pubkey], ['p', target.pubkey], ['k', String(target.kind)]];
  if (choice.emoji) {
    const {code,url} = choice.emoji;
    const tag = ['emoji',code,url];
    if (choice.content !== `:${code}:` || !emojiMap([tag])[code]) throw Error('絵文字名と画像URLを確認してください');
    tags.push(['emoji',code,emojiMap([tag])[code]]);
  } else if (choice.content !== '+' && choice.content !== '-') {
    const segments = [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(choice.content)];
    if (choice.content.length > 64 || segments.length !== 1 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(choice.content)) throw Error('絵文字を1つ入力してください');
  }
  return {kind:7, content:choice.content, tags, created_at:now};
}
export function deletionTemplate(owner:string, target:ReactionTarget, events:Event[], now=Math.floor(Date.now()/1000)):EventTemplate {
  if (!events.length || events.length > 1000 || events.some(e => !reactionMatches(e, owner, target))) throw Error('取消対象を確認できません');
  return {kind:5, content:'', created_at:now, tags:[...new Set(events.map(e => e.id))].map(id => ['e',id]).concat([['k','7']])};
}
/** Per-account verified events and permanent NIP-09 tombstones, independent of arrival order. */
export class ReactionState {
  readonly events = new Map<string,Event>();
  readonly deleted = new Set<string>();
  private byTarget = new Map<string,Set<string>>();
  constructor(readonly owner:string) {}
  receive(event:Event, target?:ReactionTarget):boolean {
    if (event.kind === 5) {
      if (!verifiedReactionEvent(event, this.owner)) return false;
      let changed = false;
      for (const tag of event.tags) if (tag[0] === 'e' && hex(tag[1]) && !this.deleted.has(tag[1])) {
        if (this.deleted.size >= 20000) break;
        this.deleted.add(tag[1]); changed = true;
      }
      return changed;
    }
    if (!target || !reactionMatches(event, this.owner, target) || this.events.has(event.id) || this.events.size >= 10000) return false;
    this.events.set(event.id,event);
    let ids=this.byTarget.get(target.id);if(!ids){ids=new Set();this.byTarget.set(target.id,ids)}ids.add(event.id);
    return true;
  }
  forTarget(target:ReactionTarget):Event[] {
    return [...(this.byTarget.get(target.id)??[])].filter(id=>!this.deleted.has(id)).map(id=>this.events.get(id)!).filter(e=>lastTag(e,'p') === target.pubkey)
      .sort((a,b) => a.created_at-b.created_at || a.id.localeCompare(b.id));
  }
}
export type ReactionReceipt = {confirmed:number; total:number};
/** Serializes mutations; an unconfirmed retry reuses the exact event ID. */
export class ReactionWriter {
  private locked = false;
  private pending = new Map<string,Event>();
  constructor(private state:ReactionState) {}
  async send(args:{target:ReactionTarget; choice?:ReactionChoice; remove?:Event[]; signal:AbortSignal; currentOwner:()=>string; sign:(event:EventTemplate)=>Promise<Event>; publish:(event:Event)=>Promise<ReactionReceipt>}) {
    const check = () => {
      if (args.signal.aborted) throw Error('操作を中止しました');
      if (args.currentOwner() !== this.state.owner) throw Error('ログイン状態が変わりました');
    };
    check();
    if (this.locked) throw Error('リアクションの送信中です');
    this.locked = true;
    try {
      const template = args.remove ? deletionTemplate(this.state.owner,args.target,args.remove) : reactionTemplate(args.target,args.choice!);
      // A remove/re-add in the same second must not recreate a tombstoned ID.
      if (!args.remove) {
        const previous=[...this.state.events.values()].filter(e=>lastTag(e,'e')===args.target.id && reactionKey(e)===reactionKey(template));
        const latest=previous.reduce((time,e)=>Math.max(time,e.created_at),-1);
        template.created_at=Math.max(template.created_at,latest+1);
        if(template.created_at>Math.floor(Date.now()/1000)+600)throw Error('少し待ってからもう一度操作してください');
      }
      const key = JSON.stringify([args.target.id,template.kind,template.content,template.tags]);
      if (!args.remove && this.state.forTarget(args.target).some(e => reactionKey(e) === reactionKey(template))) return {confirmed:0,total:0,unchanged:true};
      let event = this.pending.get(key);
      if(event&&this.state.deleted.has(event.id)){this.pending.delete(key);event=undefined;}
      if (!event) {
        const expected = JSON.stringify([template.kind,template.content,template.tags,template.created_at]);
        event = await args.sign(template); check();
        if (!verifiedReactionEvent(event,this.state.owner) || JSON.stringify([event.kind,event.content,event.tags,event.created_at]) !== expected) throw Error('署名された内容が一致しません');
        // A matching live event may have arrived while the signing extension was open.
        if (!args.remove && this.state.forTarget(args.target).some(e => reactionKey(e) === reactionKey(template))) return {confirmed:0,total:0,unchanged:true};
        this.pending.set(key,event);
      }
      check();
      const receipt = await args.publish(event);
      // Publication cannot be recalled once dispatched. Never apply it to a new session.
      check();
      if (receipt.confirmed > 0) { this.state.receive(event,args.target); this.pending.delete(key); }
      return {...receipt,unchanged:false};
    } finally { this.locked = false; }
  }
}
