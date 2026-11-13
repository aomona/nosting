import {safeMediaUrl} from './note-media';
export type EmojiMap=Record<string,string>;
export function emojiMap(tags:string[][]=[]):EmojiMap{
 const result:EmojiMap=Object.create(null),conflicts=new Set<string>();let count=0;
 for(const t of tags){if(t[0]!=='emoji'||typeof t[1]!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(t[1])||typeof t[2]!=='string'||t[2].length>2048)continue;const code=t[1],url=safeMediaUrl(t[2]);if(!url||conflicts.has(code))continue;if(result[code]&&result[code]!==url){delete result[code];conflicts.add(code);continue}if(!result[code]){if(count>=64)continue;count++}result[code]=url;}return result;
}
export function emojiParts(text:string,map:EmojiMap){const parts:({text:string}|{code:string;url:string})[]=[];let at=0,count=0;for(const m of text.matchAll(/:([A-Za-z0-9_-]{1,64}):/g)){const url=Object.hasOwn(map,m[1])?map[m[1]]:null;if(!url||count>=128)continue;if(m.index!>at)parts.push({text:text.slice(at,m.index)});parts.push({code:m[1],url});at=m.index!+m[0].length;count++}if(at<text.length)parts.push({text:text.slice(at)});return parts;}
