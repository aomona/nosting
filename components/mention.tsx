'use client';
import {createContext,useContext,useEffect,useRef} from 'react';
import {nip19} from 'nostr-tools';
import type {Profile} from '../lib/profiles';
import './mention.css';
export type MentionContextValue={profiles:Record<string,Profile>;request:(pubkey:string)=>void;openProfile:(pubkey:string)=>void};
export const MentionContext=createContext<MentionContextValue|null>(null);
export default function Mention({pubkey}:{pubkey:string}){const context=useContext(MentionContext),element=useRef<HTMLAnchorElement>(null),request=useRef(context?.request);request.current=context?.request;const profile=context?.profiles[pubkey];const name=profile?.display_name||profile?.name||`${pubkey.slice(0,8)}…${pubkey.slice(-4)}`;
 useEffect(()=>{if(profile||!element.current)return;let sent=false;const ask=()=>{if(!sent){sent=true;request.current?.(pubkey)}};if(typeof IntersectionObserver==='undefined'){ask();return}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){ask();observer.disconnect()}},{rootMargin:'200px'});observer.observe(element.current);return()=>observer.disconnect()},[pubkey,!!profile]);
 return <a ref={element} className="petal-mention" href={`nostr:${nip19.npubEncode(pubkey)}`} aria-label={`${name}のプロフィール`} onClick={e=>{if(context){e.preventDefault();e.stopPropagation();context.openProfile(pubkey)}}}>@{name}</a>
}
