'use client';
import {useEffect,useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import {findNip05Profile,type Nip05ProfileResult} from '../lib/nip05-profile';
import Nip05Details from './nip05-details';
import type {Profile} from '../lib/profiles';
import './nip05.css';
export default function Nip05Search({identifier,relays,onOpen}:{identifier:string;relays:string[];onOpen:(pubkey:string,profile:Profile)=>void}) {
 const [snapshot,setSnapshot] = useState<{key:string;value:Nip05ProfileResult}|null>(null);
 const relayKey = JSON.stringify(relays);
 const requestKey = identifier+':'+relayKey;
 const result = snapshot?.key === requestKey ? snapshot.value : null;
 useEffect(() => {
  const abort = new AbortController();
  void findNip05Profile(identifier,JSON.parse(relayKey),abort.signal).then(value => {if (!abort.signal.aborted) setSnapshot({key:requestKey,value})});
  return () => abort.abort();
 },[identifier,relayKey,requestKey]);
 const name=result?.status==='found'?(result.profile.display_name || result.profile.name):'';
 return <section className="nip05-search" aria-label="NIP-05 検索結果">
  {result?.status==='found'?<div className="nip05-search-row"><M3eButton variant="text" className="nip05-open-profile" aria-label={name&&name!==identifier?`${name} ${identifier}`:identifier} onClick={() => onOpen(result.pubkey,result.profile)}>{name&&name!==identifier&&<span className="nip05-result-name">{name}</span>}<span className="nip05-result-address">{identifier}</span></M3eButton><Nip05Details identifier={identifier} state="matched" partial={result.partial} iconOnly/></div>:<p role="status">{!result?'プロフィールを確認中…':'プロフィールとの対応を確認できませんでした'}</p>}
 </section>;
}
