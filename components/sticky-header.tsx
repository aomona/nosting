'use client';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import './sticky-header.css';
/** One header/one set of controls; the mobile placeholder prevents layout jumps. */
export default function StickyHeader({children}:{children:ReactNode}){
 const [floating,setFloating]=useState(false),[height,setHeight]=useState(56);
 const header=useRef<HTMLElement>(null),isFloating=useRef(false);
 useLayoutEffect(()=>{isFloating.current=floating;},[floating]);
 useLayoutEffect(()=>{
  const element=header.current;if(!element)return;
  const measure=()=>{if(!isFloating.current){const next=Math.ceil(element.getBoundingClientRect().height);if(next>0)setHeight(old=>old===next?old:next)}};
  measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const mobile=window.matchMedia('(max-width:650px)');let frame=0;
  const update=()=>{frame=0;const next=mobile.matches&&window.scrollY>80;setFloating(old=>old===next?old:next)};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)};
  update();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});mobile.addEventListener('change',schedule);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);mobile.removeEventListener('change',schedule)};
 },[]);
 return <div className={`petal-header-anchor${floating?' is-floating':''}`} style={{minHeight:height}}><header ref={header} className="petal-top-header">{children}</header></div>;
}
