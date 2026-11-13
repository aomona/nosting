export type BioPart={text:string;href?:string};
export function safeWebLink(value:string):string|undefined{try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;return url.href}catch{return}}
/** Text remains text, including markup; only explicit HTTP(S) URLs become links. */
export function profileBioParts(text:string):BioPart[]{
 const parts:BioPart[]=[];let end=0;
 for(const match of text.matchAll(/https?:\/\/[^\s<>"'\u3000]+/gi)){
  const start=match.index!;const raw=match[0];let candidate=raw.replace(/[.,!?;:、。！？）】」』]+$/u,'');
  while(candidate.endsWith(')')&&(candidate.match(/\)/g)||[]).length>(candidate.match(/\(/g)||[]).length)candidate=candidate.slice(0,-1);
  if(start>end)parts.push({text:text.slice(end,start)});
  const href=safeWebLink(candidate);parts.push({text:candidate,...(href?{href}:{})});end=start+candidate.length;
 }
 if(end<text.length)parts.push({text:text.slice(end)});return parts;
}
