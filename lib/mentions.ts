import {nip19} from 'nostr-tools';
import type {Root,Element} from 'hast';
export function mentionKey(uri:string):string|null{
 if(uri.length>4096||!/^nostr:(npub1|nprofile1)/i.test(uri))return null;
 try{const d=nip19.decode(uri.slice(6));const key=d.type==='npub'?d.data:d.type==='nprofile'?d.data.pubkey:null;return key&&/^[a-f0-9]{64}$/.test(key)?key:null}catch{return null}
}
export function mentionParts(text:string){const result:({text:string}|{pubkey:string;raw:string})[]=[];let at=0,count=0;for(const m of text.matchAll(/nostr:(?:npub1|nprofile1)[a-zA-Z0-9]+/gi)){const before=text[(m.index??0)-1]||'',after=text[(m.index??0)+m[0].length]||'';if(/[\w/#?=&:%]/.test(before)||/[#/?=&:%]/.test(after))continue;const key=mentionKey(m[0]);if(!key||count>=32)continue;if(m.index!>at)result.push({text:text.slice(at,m.index)});result.push({pubkey:key,raw:m[0]});at=m.index!+m[0].length;count++}if(at<text.length)result.push({text:text.slice(at)});return result}
/** Called only after the ordinary HTML policy has run. Never nest an action in a link. */
export const MAX_POST_MENTIONS=32;
export function mentionTree(tree:Root){
 let nodes=0,mentions=0;
 function walk(node:Root|Element){
  if(node.type==='element'&&['a','code','pre'].includes(node.tagName))return;
  node.children=node.children.flatMap((child:any)=>{
   if(child.type==='text')return mentionParts(child.value).map(part=>{
    nodes++;
    if('text'in part)return {type:'text',value:part.text};
    if(mentions>=MAX_POST_MENTIONS)return {type:'text',value:part.raw};
    mentions++;return {type:'element',tagName:'span',properties:{dataMentionKey:part.pubkey},children:[]};
   });
   if(child.type==='element'){
    // secureTree leaves explicit-link labels intact until this shared budget pass.
    if(child.properties.dataMentionKey){
     if(mentions<MAX_POST_MENTIONS){mentions++;child.children=[];}
     else child.properties={};
     return [child];
    }
    walk(child);
   }
   return [child];
  }) as typeof node.children;
 }
 walk(tree);return nodes;
}
