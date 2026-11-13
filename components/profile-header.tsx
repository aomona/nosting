'use client';
import {memo,useState,type ReactNode} from 'react';
import {M3eCard} from '@m3e/react/card';
import {M3eButton} from '@m3e/react/button';
import {ArrowUpRight,Copy,Pencil} from 'lucide-react';
import EmojiText from './custom-emoji';
import ProfileAvatar from './profile-avatar';
import type {Profile} from '../lib/profiles';
import './profile-header.css';
import {profileBioParts,safeWebLink} from '../lib/profile-links';

type Props={pubkey:string;profile?:Profile;onCopy:()=>void;onEdit?:()=>void;action?:ReactNode};
const ProfileHeader=memo(function ProfileHeader({pubkey,profile,onCopy,onEdit,action}:Props){
 const [failedBanner,setFailedBanner]=useState('');
 const name=profile?.display_name.trim()||profile?.name.trim()||`${pubkey.slice(0,8)}…${pubkey.slice(-4)}`;
 const handle=profile?.name.trim();
 const banner=profile?.banner&&profile.banner!==failedBanner?profile.banner:'';
 const website=profile?.website?safeWebLink(profile.website):undefined;
 let host='ウェブサイト';try{if(website)host=new URL(website).hostname}catch{}
 return <M3eCard variant="filled" className={`petal-profile-header${banner?' has-banner':''}`}>
  <div className="petal-profile-layout">
   {banner&&<div className="petal-profile-banner"><img src={banner} alt="" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailedBanner(banner)}/></div>}
   <div className="petal-profile-details">
    <div className="petal-profile-topline"><div className="petal-profile-avatar"><ProfileAvatar picture={profile?.picture} name={name} large/></div></div>
    <div className="petal-profile-identity"><div className="petal-profile-name-row"><h2><EmojiText text={name} emojis={profile?.emojis}/></h2>{action&&<div className="petal-profile-follow">{action}</div>}</div>{handle&&<div className="petal-profile-handle">@<EmojiText text={handle} emojis={profile?.emojis}/></div>}</div>
    {profile?.about.trim()&&<p className="petal-profile-about"><>{profileBioParts(profile.about).map((part,index)=>part.href?<a key={index} href={part.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{part.text}</a>:<EmojiText key={index} text={part.text} emojis={profile.emojis}/>)}</></p>}
    <div className="petal-profile-actions">{onEdit&&<M3eButton variant="tonal" onClick={onEdit}><Pencil slot="icon" aria-hidden="true"/>編集</M3eButton>}
     {website&&<M3eButton variant="tonal" href={website} target="_blank" rel="noopener noreferrer" className="petal-profile-website" title={website}><span className="petal-profile-domain">{host}</span><ArrowUpRight slot="trailing-icon" aria-hidden="true"/></M3eButton>}
     <M3eButton variant="outlined" onClick={onCopy} aria-label="公開鍵をコピー"><Copy slot="icon" aria-hidden="true"/>公開鍵をコピー</M3eButton>
    </div>
   </div>
  </div>
 </M3eCard>;
});
export default ProfileHeader;
