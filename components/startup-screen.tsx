'use client';
import {useEffect,useState,type ComponentType} from 'react';
import './startup-screen.css';

export default function StartupScreen({failed,onRetry}:{failed:boolean;onRetry:()=>void}) {
 const [Indicator,setIndicator]=useState<ComponentType<{dark:boolean}>|null>(null);
 const [dark,setDark]=useState(false);
 useEffect(()=>{
  let active=true;
  try {setDark(localStorage.getItem('petal-dark')==='true')} catch {}
  import('./startup-indicator').then(m=>{if(active)setIndicator(()=>m.default)}).catch(()=>{/* The first-paint fallback stays usable even if this chunk fails. */});
  return()=>{active=false};
 },[]);
 return <main className="startup-screen" data-theme={dark?'dark':'light'}>
  {failed?<div className="startup-error"><p role="status">nost.ingを読み込めませんでした。</p><button type="button" onClick={onRetry}>再試行</button></div>:<div className="startup-status" role="status">
   <span className="startup-sr-only">nost.ingを読み込み中</span>
   <div className="startup-indicator" aria-hidden="true">
    {Indicator&&<div className="startup-motion"><Indicator dark={dark}/></div>}
    <div className={`startup-static${Indicator?' startup-ready':''}`}><svg width="48" height="48" viewBox="0 0 48 48" focusable="false"><path fill="currentColor" d="M24 4c7-8 15 0 12 8 11-1 14 11 4 16 7 8-1 18-10 13-3 11-16 8-16-3C3 42-3 30 6 23-4 17 2 5 12 9 13-1 23-4 24 4Z"/></svg></div>
   </div>
  </div>}
 </main>;
}
