import type {Event} from 'nostr-tools';
import {noteShareUri} from './share-note';
import {buildContentTags} from './publication-tags';

/** A quote is a new note, not a reply or a kind-6 repost. Never inherit source tags. */
export function quotePost(source:Pick<Event,'id'|'pubkey'|'kind'>,text:string){
 if(source.kind!==1)throw Error('この投稿は引用できません');
 if(!text.trim())throw Error('本文を入力してください');
 // No guessed relay hint: the configured write relays are not evidence of
 // where the original lives. nevent includes its author for discovery.
 const reference=noteShareUri(source);
 const content=`${text.trim()}\n\n${reference}`;
 // Put the selected source first, even when the commentary mentions other notes.
 const tags=buildContentTags(content,buildContentTags(reference));
 return {kind:1,content,tags};
}
