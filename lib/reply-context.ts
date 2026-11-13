import type {Event} from 'nostr-tools';
import {replyParent} from './thread-replies';

export type ReplyTarget={id:string|null};
/** NIP-10: use the immediate parent, never a p-tag participant or q-tag quote. */
export function replyTarget(event:Pick<Event,'id'|'kind'|'tags'>):ReplyTarget|null{
 if(event.kind!==1)return null;
 const id=replyParent(event.tags);
 if(id)return {id:id===event.id?null:id};
 // Keep the reply label for malformed/ambiguous explicit reply references.
 return event.tags.some(tag=>tag[0]==='e'&&(tag[3]==='root'||tag[3]==='reply'))?{id:null}:null;
}
export function replyExcerpt(event:Pick<Event,'content'|'tags'>):string{
 if(event.tags.some(tag=>tag[0]==='content-warning'))return 'センシティブな投稿';
 return event.content.replace(/\s+/g,' ').trim().slice(0,180)||'本文のない投稿';
}
