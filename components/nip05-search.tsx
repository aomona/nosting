'use client';
import {useEffect,useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import {findNip05Profile,type Nip05ProfileResult} from '../lib/nip05-profile';
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
 return <section className="nip05-search" aria-label="NIP-05 検索結果">
  {!result?<p role="status">プロフィールを確認中…</p>:result.status === 'found'?<><M3eButton variant="tonal" onClick={() => onOpen(result.pubkey,result.profile)}>{result.profile.display_name || result.profile.name || identifier}</M3eButton><div className="nip05-identifier"><span>{identifier}</span><small>公開鍵と一致</small></div>{result.partial&&<p role="status">一部のリレーは未確認です</p>}</>:<p role="status">プロフィールとの対応を確認できませんでした</p>}
 </section>;
}
