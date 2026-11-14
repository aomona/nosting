'use client';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Event} from 'nostr-tools';
import {accountEventMuted, loadMuteList, readMuteList, saveMuteEdit, type MuteEdit, type MuteList, type MuteSigner} from '../lib/account-mutes';
import {isLatestReplaceable} from '../lib/latest-event';

export function useAccountMutes(owner: string, relays: string[], currentOwner: () => string, publish: (event: Event) => Promise<{confirmed: number; total: number}>) {
 const relayKey = JSON.stringify(relays), key = owner + relayKey;
 const [state, setState] = useState<{key: string; list: MuteList | null; ready: boolean; loading: boolean; error: string}>({key: '', list: null, ready: false, loading: false, error: ''});
 const current = useRef(state), active = useRef(key), request = useRef<AbortController | null>(null), locked = useRef<string | null>(null);
 const callbacks = useRef({currentOwner, publish});
 useLayoutEffect(() => {active.current = key; callbacks.current = {currentOwner, publish};}, [key, currentOwner, publish]);
 const signer = () => (window as Window & {nostr?: MuteSigner}).nostr;
 const reload = useCallback(async () => {
  if (!owner || locked.current === key) return;
  request.current?.abort(); const controller = new AbortController(); request.current = controller;
  const old = current.current.key === key ? current.current.list : null;
  const update = (list: MuteList | null, ready: boolean, loading: boolean, error: string) => {if (controller.signal.aborted || active.current !== key) return; current.current = {key, list, ready, loading, error}; setState(current.current);};
  update(old, false, true, '');
  try {
   const result = await loadMuteList(owner, JSON.parse(relayKey), controller.signal);
   const event = old?.event && (!result.event || !isLatestReplaceable(old.event, result.event)) ? old.event : result.event;
   const list = await readMuteList(event, owner, signer());
   // A failed decrypt refresh must not discard previously decrypted, verified items.
   if (list.privateTags === null && old?.event?.id === event?.id && old?.privateTags) list.privateTags = old.privateTags;
   update(list, result.complete && list.privateTags !== null && !list.warning, false, !result.complete ? '一部のリレーが未応答です。保存前に再読み込みしてください' : list.warning);
  } catch (e) {update(old, false, false, e instanceof Error ? e.message : '取得できません');}
 }, [key, owner, relayKey]);
 useEffect(() => {void reload(); return () => {request.current?.abort();};}, [reload]);
 const list = state.key === key ? state.list : null;
 const isMuted = useCallback((event: Parameters<typeof accountEventMuted>[0]) => accountEventMuted(event, list), [list]);
 async function save(edit: MuteEdit, signal: AbortSignal) {
  if (locked.current === key || active.current !== key || current.current.key !== key || !current.current.ready || !current.current.list) throw Error('一覧を再読み込みしてください');
  const extension = signer(); if (!extension) throw Error('署名機能に接続してください');
  locked.current = key;
  try {
   const result = await saveMuteEdit({owner, base: current.current.list, edit, signal, currentOwner: () => active.current === key ? callbacks.current.currentOwner() : '', load: () => loadMuteList(owner, JSON.parse(relayKey), signal), signer: extension, publish: event => callbacks.current.publish(event)});
   if (active.current === key && !signal.aborted) {current.current = {key, list: result.confirmed ? result.list : current.current.list, ready: false, loading: false, error: result.confirmed ? '' : '受信確認が取れません。再読み込みしてください'}; setState(current.current);}
   return result;
  } finally {if (locked.current === key) locked.current = null;}
 }
 return {list, ready: state.key === key && state.ready, loading: state.key === key && state.loading, error: state.key === key ? state.error : '', isMuted, reload, save};
}
