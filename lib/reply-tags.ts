import type {Event} from 'nostr-tools';
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
type ReplySource=Pick<Event,'id'|'kind'|'pubkey'|'tags'>;
/** Build a NIP-10 kind-1 reply. Existing author hints remain hints, never guessed. */
export function makeReplyTags(parent:ReplySource):string[][]{
 if(parent.kind!==1)throw Error('この種類の投稿への返信には対応していません');
 if(!hex(parent.id)||!hex(parent.pubkey)||!Array.isArray(parent.tags))throw Error('返信元の投稿を確認できません');
 const es=parent.tags.filter(t=>Array.isArray(t)&&t[0]==='e'&&hex(t[1]));
 const marked=es.filter(t=>t[3]==='root');
 if(new Set(marked.map(t=>t[1])).size>1)throw Error('返信元のスレッド起点が不明です');
 let root=marked[0];
 if(!root){
  // Positional interpretation only applies to wholly unmarked e tags.
  if(es.every(t=>!t[3]))root=es[0];
  else if(es.some(t=>t[3]==='reply'))throw Error('返信元のスレッド起点が不明です');
 }
 const rootId=root?.[1]||parent.id;
 const rootAuthor=rootId===parent.id?parent.pubkey:hex(root?.[4])?root[4]:undefined;
 const eTag=(id:string,marker:string,author?:string)=>author?['e',id,'',marker,author]:['e',id,'',marker];
 const result=[eTag(rootId,'root',rootAuthor)];
 if(rootId!==parent.id)result.push(eTag(parent.id,'reply',parent.pubkey));
 const people=new Set([parent.pubkey]);
 for(const t of parent.tags)if(Array.isArray(t)&&t[0]==='p'&&hex(t[1]))people.add(t[1]);
 for(const key of people)result.push(['p',key]);
 return result;
}
