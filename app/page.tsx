"use client";
import StartupScreen from '../components/startup-screen';
import {useEffect,useState, type ComponentType} from 'react';
export default function Page(){const [App,setApp]=useState<ComponentType|null>(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);useEffect(()=>{let active=true;setFailed(false);import('../components/petal-app').then(m=>{if(active)setApp(()=>m.default)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[attempt]);return App?<App/>:<StartupScreen failed={failed} onRetry={()=>setAttempt(n=>n+1)}/>;}
