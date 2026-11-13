export type NoteMedia={url:string;type:'image'|'video';alt:string;width?:number;height?:number};
/** NIP-92 delegates dim to NIP-94: positive integer width x height pixels. */
export function mediaDimensions(value:string|undefined):{width:number;height:number}|undefined{
 if(!value||!/^([1-9]\d{0,4})x([1-9]\d{0,4})$/.test(value))return;
 const [width,height]=value.split('x').map(Number);
 if(width>32768||height>32768||width*height>268435456)return;
 return {width,height};
}
/** Stable bounded feed frame, independent of remote image decoding/load errors. */
export function mediaAspectRatio(item:NoteMedia):number{
 const width=item.width,height=item.height;
 if(width&&height&&Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0)return Math.max(.5,Math.min(3,width/height));
 return item.type==='video'?16/9:4/3;
}
export function safeMediaUrl(value:string):string|null{
 try{const u=new URL(value);const h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return null;
 if(!h.includes('.')||h.endsWith('.local')||h.endsWith('.localhost')||h.endsWith('.internal')||h==='localhost'||h.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(h))return null;
 return u.href;}catch{return null}
}
export function noteMedia(content:string,tags:string[][]=[]){
 const items:NoteMedia[]=[];const urls=new Set<string>();
 const add=(raw:string,mime='',alt='',dim?:string)=>{const url=safeMediaUrl(raw);if(!url||urls.has(url)||items.length>=6)return;const ext=new URL(url).pathname.toLowerCase();const type=/\.(png|jpe?g|gif|webp|avif)$/.test(ext)||/^image\/(jpeg|png|gif|webp|avif)$/.test(mime)?'image':/\.(mp4|webm|ogv|mov)$/.test(ext)||/^video\/(mp4|webm|ogg|quicktime)$/.test(mime)?'video':null;if(!type)return;urls.add(url);items.push({url,type,alt:alt.slice(0,500),...mediaDimensions(dim)});};
 for(const t of tags){if(t[0]!=='imeta')continue;const fields=Object.fromEntries(t.slice(1).map(s=>{const i=s.indexOf(' ');return i<0?[s,'']:[s.slice(0,i),s.slice(i+1)]}));if(fields.url)add(fields.url,fields.m,fields.alt,fields.dim)}
 for(const match of content.matchAll(/https:\/\/[^\s<>"\u3000]+/g))add(match[0].replace(/[),。！!？?]+$/,''));
 let text=content;for(const item of items)text=text.split(item.url).join('');return {items,text:text.trim(),sensitive:tags.some(t=>t[0]==='content-warning')};
}
