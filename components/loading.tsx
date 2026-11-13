'use client';
import {M3eLoadingIndicator} from '@m3e/react/loading-indicator';
import {useEffect,useState} from 'react';
export default function Loading(){
 const [reduced,setReduced]=useState(true);
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 return <div className="petal-loading" role="status" aria-label="読み込み中">{reduced?<span>読み込み中…</span>:<M3eLoadingIndicator variant="contained" aria-hidden="true"/>}</div>
}
