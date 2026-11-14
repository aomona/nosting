'use client';
import {useEffect,useState} from 'react';
import {NIP05_CACHE_MS,nip05Resolver,type Nip05Result} from '../lib/nip05';
import Nip05Details from './nip05-details';
export default function Nip05Identifier({identifier,pubkey}:{identifier:string;pubkey:string}) {
 const [result,setResult] = useState<{identifier:string;pubkey:string;value:Nip05Result}|null>(null);
 useEffect(() => {
  const abort = new AbortController();
  const check = async () => {
   setResult(null);
   const value = await nip05Resolver.resolve(identifier,abort.signal);
   if (!abort.signal.aborted) setResult({identifier,pubkey,value});
  };
  void check();
  const timer = setInterval(() => void check(),NIP05_CACHE_MS);
  return () => {abort.abort();clearInterval(timer)};
 },[identifier,pubkey]);
 const current = result?.identifier === identifier && result.pubkey === pubkey ? result.value : null;
 const matched = current?.status === 'resolved' && current.pubkey === pubkey;
 return <Nip05Details identifier={identifier} state={matched?'matched':current?'unconfirmed':'checking'}/>;
}
