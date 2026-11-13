'use client';
import {Fragment,memo,useState} from 'react';
import {emojiParts,type EmojiMap} from '../lib/custom-emoji';
import './custom-emoji.css';
export const CustomEmoji=memo(function CustomEmoji({code,url}:{code:string;url:string}){const[failed,setFailed]=useState('');return failed===url?<>{`:${code}:`}</>:<img className="petal-custom-emoji" src={url} alt={`:${code}:`} title={`:${code}:`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>});
export default function EmojiText({text,emojis={}}:{text:string;emojis?:EmojiMap}){return <>{emojiParts(text,emojis).map((part,i)=>'text'in part?<Fragment key={i}>{part.text}</Fragment>:<CustomEmoji key={`${i}:${part.url}`} code={part.code} url={part.url}/>)}</>}
