'use client';
import {memo,useEffect,useState} from 'react';
import {formatNoteTime,validTimestamp} from '../lib/note-time';
import {subscribeNoteTime} from '../lib/note-clock';
const NoteTime=memo(function NoteTime({createdAt}:{createdAt:number}){
 const [now,setNow]=useState(0);
 useEffect(()=>subscribeNoteTime(createdAt,setNow),[createdAt]);
 const date=validTimestamp(createdAt)?new Date(createdAt*1000):null;
 const exact=now&&date?new Intl.DateTimeFormat('ja-JP',{dateStyle:'full',timeStyle:'long'}).format(date):undefined;
 return <time dateTime={date?.toISOString()} title={exact} aria-label={exact}>{formatNoteTime(createdAt,now)}</time>;
});
export default NoteTime;
