'use client';
import {useEffect, useRef, useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import {editableMute, type MuteEdit, type MuteType} from '../lib/account-mutes';
import type {useAccountMutes} from './use-account-mutes';
import './mute-settings.css';

export default function AccountMuteSettings({list, ready, loading, error, reload, save}: ReturnType<typeof useAccountMutes>) {
 const [type, setType] = useState<MuteType>('p'), [scope, setScope] = useState<'private' | 'public'>('private'), [value, setValue] = useState('');
 const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
 const request = useRef<AbortController | null>(null), lock = useRef(false);
 useEffect(() => () => {request.current?.abort();}, []);
 async function submit(edit: MuteEdit) {
  if (lock.current || !ready) return;
  lock.current = true; setBusy(true); setMessage(''); const controller = new AbortController(); request.current = controller;
  try {
   const result = await save(edit, controller.signal);
   if (!controller.signal.aborted) {setMessage(`${result.confirmed}/${result.total}か所で保存を確認${result.confirmed < result.total ? '（残りは未確認）' : ''}`); if (result.confirmed) setValue('');}
  } catch (e) {if (!controller.signal.aborted) setMessage(e instanceof Error ? e.message : '保存できません');}
  finally {if (!controller.signal.aborted) {lock.current = false; setBusy(false);}}
 }
 const disabled = busy || loading || !ready;
 const labels = {p: 'ユーザー', word: 'ワード', t: 'ハッシュタグ', e: 'スレッド'};
 return <section className="petal-mute-settings account-mute-settings" aria-label="アカウントのミュート" aria-busy={busy || loading}>
  <h3>アカウントのミュート</h3>
  {(['public', 'private'] as const).map(visibility => <div key={visibility}><h4>{visibility === 'public' ? '公開' : '非公開'}</h4><ul>{(visibility === 'public' ? list?.event?.tags ?? [] : list?.privateTags ?? []).map((tag, index) => editableMute(tag) ? <li key={index}><span>{labels[tag[0] as MuteType]}: {tag[1]}</span><M3eButton disabled={disabled} aria-label={`${visibility === 'public' ? '公開' : '非公開'}の${tag[1]}を解除`} onClick={() => void submit({scope: visibility, type: tag[0] as MuteType, value: tag[1], remove: true})}>解除</M3eButton></li> : null)}</ul></div>)}
  <form onSubmit={e => {e.preventDefault(); void submit({scope, type, value});}}>
   <div className="account-mute-options"><label>公開範囲<select aria-label="公開範囲" value={scope} disabled={disabled} onChange={e => setScope(e.target.value as typeof scope)}><option value="private">非公開</option><option value="public">公開</option></select></label><label>種類<select aria-label="種類" value={type} disabled={disabled} onChange={e => setType(e.target.value as MuteType)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
   <label htmlFor="account-mute-value">{type === 'p' ? 'ユーザーの公開鍵' : type === 'e' ? 'スレッドの投稿ID' : labels[type]}</label><div><input id="account-mute-value" value={value} disabled={disabled} maxLength={200} autoComplete="off" onChange={e => setValue(e.target.value)}/><M3eButton type="submit" variant="filled" disabled={disabled || !value.trim()}>{busy ? '保存中…' : scope === 'public' ? '公開して追加' : '追加'}</M3eButton></div>
  </form>
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  <M3eButton disabled={busy || loading} onClick={() => {setMessage(''); void reload();}}>{loading ? '読み込み中…' : '再読み込み'}</M3eButton>
 </section>;
}
