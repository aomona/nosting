'use client';
import {useState} from 'react';
import {M3eAvatar} from '@m3e/react/avatar';
export default function ProfileAvatar({picture,name,large=false}:{picture?:string;name:string;large?:boolean}){const[failed,setFailed]=useState('');return <M3eAvatar className={large?'profile-avatar large':'profile-avatar'}>{picture&&failed!==picture?<img src={picture} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(picture)}/>:Array.from(name.trim())[0]||'?'}</M3eAvatar>}
