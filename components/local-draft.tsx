'use client';
import {createContext,useContext,useLayoutEffect,useRef,useState} from 'react';
import {clearSentDraft,draftKey,readDraft,writeDraft} from '../lib/local-drafts';
function storage():Storage{try{return window.localStorage}catch{return {getItem(){throw Error('unavailable')},setItem(){throw Error('unavailable')},removeItem(){throw Error('unavailable')}} as unknown as Storage}}
export const DraftOwnerContext=createContext('');
export function useLocalDraft(target='post'){
 const owner=useContext(DraftOwnerContext);
 return useAccountDraft(owner,target);
}
export function useAccountDraft(owner:string,target='post'){
 const key=draftKey(owner,target),currentKey=useRef(key);currentKey.current=key;
 const [state,setState]=useState({key,text:'',saved:true});
 useLayoutEffect(()=>{setState({key,text:readDraft(storage(),key),saved:true})},[key]);
 const text=state.key===key?state.text:'';
 const latest=useRef(text);latest.current=text;
 function setText(value:string|((previous:string)=>string)){
  const next=typeof value==='function'?value(latest.current):value;
  latest.current=next;
  const saved=writeDraft(storage(),key,next);setState({key,text:next,saved});
 }
 function accepted(sent:string){clearSentDraft(storage(),key,sent);if(currentKey.current===key)setState(previous=>previous.key===key&&previous.text===sent?{key,text:'',saved:true}:previous)}
 return {text,setText,accepted,saved:state.saved};
}
