import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {Root} from 'mdast';
import type {Root as HtmlRoot, RootContent, Element} from 'hast';
import {noteMedia, safeMediaUrl, type NoteMedia} from './note-media';

interface Node {type:string;url?:string;alt?:string;identifier?:string;value?:string;children?:Node[];data?:{hName:string;hProperties:Record<string,string>}}
export function safeMarkdownLink(raw:string):string|undefined {
 if(!/^https?:\/\//i.test(raw))return undefined;
 try {const url=new URL(raw);return !url.username&&!url.password&&['http:','https:'].includes(url.protocol)?url.href:undefined}catch{return undefined}
}
/** Transform only AST image/bare-link nodes; code and labelled links stay intact. */
export function extractMarkdownMedia(tree:Root,tags:string[][]=[]):NoteMedia[]{
 // NIP-92 metadata describes URLs in the body; tag order is not display order.
 const metadata=new Map<string,NoteMedia>();
 for(const tag of tags){const item=noteMedia('',[tag]).items[0];if(item&&!metadata.has(item.url))metadata.set(item.url,item);}
 const items:NoteMedia[]=[];
 const seen=new Set<string>();
 const definitions=new Map<string,string>();
 const root=tree as unknown as Node;
 function index(node:Node){if(node.type==='definition'&&node.identifier&&node.url)definitions.set(node.identifier.toUpperCase(),node.url);node.children?.forEach(index)}index(root);
 function add(url:string,alt=''){
  const safe=safeMediaUrl(url);if(!safe)return false;
  if(seen.has(safe))return true;
  if(items.length>=6)return false;
  const item=metadata.get(safe)||noteMedia('',[['imeta',`url ${safe}`,`alt ${alt}`]]).items[0];
  if(!item)return false;items.push(item);seen.add(item.url);return true;
 }
 function media(url:string,alt=''):Node[]|undefined{
  const previous=items.length;
  if(!add(url,alt))return;
  // Repeated occurrences are consumed once, including Markdown + bare URL pairs.
  return items.length===previous?[]:[{type:'petalMedia',data:{hName:'div',hProperties:{dataMediaIndices:String(previous)}},children:[]}];
 }
 function walk(node:Node){
  if(!node.children)return;
  node.children=node.children.flatMap(child=>{
   const image=child.type==='image'||child.type==='imageReference';
   const url=child.url||(child.identifier?definitions.get(child.identifier.toUpperCase()):undefined);
   if(image){
    const replacement=url?media(url,child.alt):undefined;
    if(replacement)return replacement;
    // Unsupported/excess images are links, never independent remote <img>s.
    return [{type:'link',url:url||'',children:[{type:'text',value:child.alt||'画像'}]}];
   }
   if(child.type==='link'&&url&&child.children?.length===1&&child.children[0].type==='text'&&child.children[0].value===url){const replacement=media(url);if(replacement)return replacement;}
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

/** Lift media out of phrasing wrappers so cards never sit inside <p> or <a>.
 * Preserve lists, blockquotes and tables, grouping only adjacent media siblings.
 */
export function arrangeInlineMedia(tree:HtmlRoot){
 const isMedia=(node:RootContent):node is Element & {properties:{dataMediaIndices:string}}=>node.type==='element'&&node.properties.dataMediaIndices!==undefined;
 const isSpace=(node:RootContent)=>node.type==='text'&&!node.value.trim()||node.type==='element'&&node.tagName==='br';
 const phrasing=new Set(['p','h1','h2','h3','h4','h5','h6','em','strong','del','a']);
 function visit(node:RootContent):RootContent[]{
  if(node.type!=='element'||isMedia(node))return [node];
  const children=node.children.flatMap(visit);
  if(phrasing.has(node.tagName)&&children.some(isMedia)){
   const result:RootContent[]=[];let pending:RootContent[]=[];
   const flush=()=>{while(pending.length&&isSpace(pending[0]))pending.shift();while(pending.length&&isSpace(pending[pending.length-1]))pending.pop();if(pending.length)result.push({...node,children:pending as Element['children']});pending=[];};
   for(const child of children){if(isMedia(child)){flush();result.push(child);}else pending.push(child);}flush();
   return result;
  }
  node.children=group(children) as Element['children'];return [node];
 }
 function group(children:RootContent[]):RootContent[]{
  const result:RootContent[]=[];
  for(let i=0;i<children.length;i++){
   const child=children[i];
   if(isMedia(child)){
    const indices=[String(child.properties.dataMediaIndices)];
    let end=i;
    for(let j=i+1;j<children.length;j++){
     const next=children[j];
     if(isSpace(next))continue;
     if(!isMedia(next))break;
     indices.push(String(next.properties.dataMediaIndices));end=j;
    }
    result.push({...child,properties:{dataMediaIndices:indices.join(',')}});i=end;
   }else result.push(child);
  }
  return result;
 }
 tree.children=group(tree.children.flatMap(visit));
}
