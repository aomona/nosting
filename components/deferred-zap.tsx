'use client';
import {useEffect,useState,type ComponentProps,type ComponentType} from 'react';
import type ZapPanel from './zap-panel';
import Loading from './loading';
import {M3eButton} from '@m3e/react/button';
type Props=ComponentProps<typeof ZapPanel>;
export default function DeferredZap(props:Props){
 const [Panel,setPanel]=useState<ComponentType<Props>|null>(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setFailed(false);import('./zap-panel').then(m=>{if(active)setPanel(()=>m.default)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[attempt]);
 return Panel?<Panel {...props}/>:failed?<div role="status"><p>Zap画面を読み込めませんでした。</p><M3eButton onClick={()=>setAttempt(n=>n+1)}>再試行</M3eButton></div>:<Loading/>;
}
