'use client';
import {useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import AccountMuteSettings from './account-mute-settings';
import MuteSettings from './mute-settings';
import type {useAccountMutes} from './use-account-mutes';
import type {useLocalMutes} from './use-local-mutes';

export default function MuteSettingsPanel({account,local}:{account?:ReturnType<typeof useAccountMutes>;local:ReturnType<typeof useLocalMutes>}){
 const [destination,setDestination]=useState<'account'|'local'>(account?'account':'local');
 return <div className="mute-settings-panel">{account&&<div className="mute-destinations" role="group" aria-label="保存先"><M3eButton toggle selected={destination==='account'} onBeforeInput={e=>e.preventDefault()} variant={destination==='account'?'tonal':'outlined'} onClick={()=>setDestination('account')}>アカウント</M3eButton><M3eButton toggle selected={destination==='local'} onBeforeInput={e=>e.preventDefault()} variant={destination==='local'?'tonal':'outlined'} onClick={()=>setDestination('local')}>この端末</M3eButton></div>}{destination==='account'&&account?<AccountMuteSettings {...account}/>:<MuteSettings {...local}/>}</div>;
}
