import {mentionKey,mentionTree} from './mentions';
import Mention from '../components/mention';
import {emojiMap,emojiParts,type EmojiMap} from './custom-emoji';
import {CustomEmoji} from '../components/custom-emoji';
import {Fragment,type ReactElement} from 'react';
import {nip19} from 'nostr-tools';
import {jsx,jsxs} from 'react/jsx-runtime';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import {toJsxRuntime} from 'hast-util-to-jsx-runtime';
import type {Root as MdRoot} from 'mdast';
import type {Root,RootContent,Element} from 'hast';
import {extractMarkdownMedia,safeMarkdownLink} from './markdown-media';
import type {NoteMedia} from './note-media';

type Compiled={body:ReactElement;items:NoteMedia[];sensitive:boolean};
type Entry={value:Compiled;chars:number;nodes:number};
// Bound source keys AND retained tree complexity. This stores no mounted DOM,
// media elements, component state, credentials, or network responses.
export const MARKDOWN_CACHE_LIMITS={entries:750,chars:2_000_000,nodes:100_000};
const cache=new Map<string,Entry>();
let totalChars=0,totalNodes=0,compiles=0,hits=0;
export function markdownCacheStats(){return {entries:cache.size,chars:totalChars,nodes:totalNodes,compiles,hits}}
export function clearMarkdownCache(){cache.clear();totalChars=0;totalNodes=0;compiles=0;hits=0}
const parser=unified().use(remarkParse).use(remarkGfm);
const transformer=unified().use(remarkBreaks).use(remarkRehype);

/** No raw HTML is passed by remark-rehype. Apply a fixed policy before cache. */
function secureTree(tree:Root):number {
 let nodes=1;
 function clean(parent:Root|Element){
  parent.children=parent.children.flatMap((child:RootContent)=>{
   if(child.type==='raw')return [];
   nodes++;
   if(child.type==='element'){
    if(child.tagName==='img')return [{type:'text',value:String(child.properties.alt||'画像')}];
    if(child.tagName==='a'){
     const key=mentionKey(String(child.properties.href||''));
     if(key){child.tagName='span';child.properties={dataMentionKey:key};clean(child);return [child];}
     const href=safeMarkdownLink(String(child.properties.href||''));
     if(href)child.properties={href,target:'_blank',rel:['noopener','noreferrer','nofollow','ugc']};
     else {child.tagName='span';child.properties={};}
    }
    if(child.tagName==='input')child.properties={type:'checkbox',checked:!!child.properties.checked,disabled:true,ariaLabel:child.properties.checked?'完了':'未完了'};
    clean(child);
   }
   return [child];
  }) as typeof parent.children;
 }clean(tree);return nodes;
}
// Keep source intact for copying; shorten valid event references in rendered text.
// Code nodes are opaque, so inline/fenced examples are never rewritten.
function compactReferences(node:any){
 if(['code','inlineCode','html'].includes(node.type))return;
 if(node.type==='text')node.value=node.value.replace(/(?:nostr:)?\b((?:nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi,(raw:string,encoded:string)=>{
  try{const decoded=nip19.decode(encoded);const id=decoded.type==='note'?decoded.data:decoded.type==='nevent'?decoded.data.id:null;return id?`引用（${id.slice(0,8)}…）`:raw}catch{return raw}
 });
 node.children?.forEach(compactReferences);
}
// Insert only generated, validated emoji nodes after sanitizing the ordinary tree.
function emojifyTree(tree:Root,map:EmojiMap){let added=0;function visit(node:Root|Element){if(node.type==='element'&&['code','pre'].includes(node.tagName))return;node.children=node.children.flatMap((child:any)=>{if(child.type==='text'){return emojiParts(child.value,map).map(part=>{added++;return 'text'in part?{type:'text',value:part.text}:{type:'element',tagName:'span',properties:{dataEmojiCode:part.code,dataEmojiUrl:part.url},children:[]}})}if(child.type==='element')visit(child);return [child]}) as typeof node.children;}visit(tree);return added;}
export function compileMarkdown(content:string,tags:string[][]=[]):Compiled{
 // Full, untruncated key: non-rendering event tags cannot invalidate this cache.
 const relevant=tags.filter(t=>t[0]==='imeta'||t[0]==='content-warning'||t[0]==='emoji');
 const key=JSON.stringify([content,relevant]);
 const saved=cache.get(key);
 if(saved){cache.delete(key);cache.set(key,saved);hits++;return saved.value;}
 compiles++;
 const source=parser.parse(content) as MdRoot;
 compactReferences(source);
 const items=extractMarkdownMedia(source,relevant);
 const tree=transformer.runSync(source) as Root;
 const nodes=secureTree(tree)+mentionTree(tree)+emojifyTree(tree,emojiMap(relevant));
 const body=toJsxRuntime(tree,{Fragment,jsx,jsxs,passKeys:true,components:{
  span:(props:any)=>props['data-mention-key']?<Mention pubkey={props['data-mention-key']}/>:props['data-emoji-code']&&props['data-emoji-url']?<CustomEmoji code={props['data-emoji-code']} url={props['data-emoji-url']}/>:<span>{props.children}</span>,
  table:({children})=><div className="petal-markdown-table" tabIndex={0} role="region" aria-label="表"><table>{children}</table></div>,
 }});
 const value={body,items,sensitive:relevant.some(t=>t[0]==='content-warning')};
 if(key.length<=MARKDOWN_CACHE_LIMITS.chars&&nodes<=MARKDOWN_CACHE_LIMITS.nodes){
  while(cache.size&&(cache.size>=MARKDOWN_CACHE_LIMITS.entries||totalChars+key.length>MARKDOWN_CACHE_LIMITS.chars||totalNodes+nodes>MARKDOWN_CACHE_LIMITS.nodes)){
   const oldest=cache.keys().next().value!;const entry=cache.get(oldest)!;cache.delete(oldest);totalChars-=entry.chars;totalNodes-=entry.nodes;
  }
  cache.set(key,{value,chars:key.length,nodes});totalChars+=key.length;totalNodes+=nodes;
 }
 return value;
}
