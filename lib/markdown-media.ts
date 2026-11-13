import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {Root} from 'mdast';
import {noteMedia, safeMediaUrl, type NoteMedia} from './note-media';

interface Node {type:string;url?:string;alt?:string;identifier?:string;value?:string;children?:Node[]}
export function safeMarkdownLink(raw:string):string|undefined {
 if(!/^https?:\/\//i.test(raw))return undefined;
 try {const url=new URL(raw);return !url.username&&!url.password&&['http:','https:'].includes(url.protocol)?url.href:undefined}catch{return undefined}
}
/** Transform only AST image/bare-link nodes; code and labelled links stay intact. */
export function extractMarkdownMedia(tree:Root,tags:string[][]=[]):NoteMedia[]{
 const items=noteMedia('',tags).items;
 const seen=new Set(items.map(item=>item.url));
 const definitions=new Map<string,string>();
 const root=tree as unknown as Node;
 function index(node:Node){if(node.type==='definition'&&node.identifier&&node.url)definitions.set(node.identifier.toUpperCase(),node.url);node.children?.forEach(index)}index(root);
 function add(url:string,alt=''){
  const safe=safeMediaUrl(url);if(!safe)return false;
  if(seen.has(safe))return true;
  if(items.length>=6)return false;
  const item=noteMedia('',[['imeta',`url ${safe}`,`alt ${alt}`]]).items[0];
  if(!item)return false;items.push(item);seen.add(item.url);return true;
 }
 function walk(node:Node){
  if(!node.children)return;
  node.children=node.children.flatMap(child=>{
   const image=child.type==='image'||child.type==='imageReference';
   const url=child.url||(child.identifier?definitions.get(child.identifier.toUpperCase()):undefined);
   if(image){
    if(url&&add(url,child.alt))return [];
    // Unsupported/excess images are links, never independent remote <img>s.
    return [{type:'link',url:url||'',children:[{type:'text',value:child.alt||'画像'}]}];
   }
   if(child.type==='link'&&url&&child.children?.length===1&&child.children[0].type==='text'&&child.children[0].value===url&&add(url))return [];
   walk(child);
   if(child.type==='paragraph'&&child.children?.every(n=>n.type==='text'&&!n.value?.trim()))return [];
   return [child];
  });
 }walk(root);return items;
}
const parser=unified().use(remarkParse).use(remarkGfm);
export function markdownMedia(content:string,tags:string[][]=[]){
 const tree=parser.parse(content);return {items:extractMarkdownMedia(tree,tags),sensitive:tags.some(t=>t[0]==='content-warning')};
}
export function remarkMediaGallery(tags:string[][]){return ()=> (tree:Root)=>{extractMarkdownMedia(tree,tags)};}
