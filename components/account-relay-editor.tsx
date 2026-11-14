'use client';
import {useEffect, useRef, useState} from 'react';
import type {Event} from 'nostr-tools';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eCheckbox} from '@m3e/react/checkbox';
import RelayAuthControl, {relayAuthLabels, type RelayAuthActions} from './relay-auth-control';
import './relay-auth-control.css';
import {Plus, Trash2} from 'lucide-react';
import {editableRelayRows, type AccountRelaySnapshot} from '../lib/account-relays';
import {normalizeRelay, parseRelays, type RelayConfig} from '../lib/relays';

type Props = {
  auth?: RelayAuthActions;
  load: (signal: AbortSignal) => Promise<AccountRelaySnapshot>;
  save: (base: Event | null, rows: RelayConfig[], signal: AbortSignal) => Promise<{event: Event; confirmed: number; total: number}>;
};
export default function AccountRelayEditor({load, save, auth}: Props) {
  const [base, setBase] = useState<Event | null>(null), [rows, setRows] = useState<RelayConfig[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [url, setUrl] = useState('');
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const request = useRef<AbortController | null>(null), lock = useRef(false), loader = useRef(load);
  useEffect(() => {loader.current = load;}, [load]);
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setReady(false); setError(''); setStatus(''); setEmptyConfirmed(false);
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await loader.current(controller.signal);
      if (controller.signal.aborted) return;
      setBase(result.event); setRows(editableRelayRows(result.event));
      if (result.partial) throw Error('一部のリレーが未応答です。再読み込みしてから編集してください');
      setReady(true); setStatus(result.event ? (result.event.tags.some(tag => tag[0] === 'r') ? '' : '受信先・投稿先は設定されていません') : '公開一覧は未設定です');
    } catch (e) {if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '取得できませんでした');}
    finally {if (!controller.signal.aborted) {lock.current = false; setBusy(false);}}
  }
  useEffect(() => {void reload(); return () => {request.current?.abort(); lock.current = false;};}, []);
  function add() {
    try {setRows(parseRelays([...rows, {url: normalizeRelay(url), read: true, write: true}])); setUrl(''); setError(''); setEmptyConfirmed(false);}
    catch (e) {setError((e as Error).message);}
  }
  async function submit() {
    if (lock.current || !ready || !rows.length && !emptyConfirmed) return;
    lock.current = true; setBusy(true); setError(''); setStatus('');
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await save(base, rows, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.confirmed) {setReady(false); throw Error('受信確認が取れません。再保存前に再読み込みしてください');}
      setBase(result.event); setStatus(`${result.confirmed}/${result.total} リレーで保存を確認しました${result.confirmed < result.total ? '。残りは未確認です' : ''}`);
    } catch (e) {if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '保存できませんでした');}
    finally {if (!controller.signal.aborted) {lock.current = false; setBusy(false);}}
  }
  // Active connections may be absent from a failed/incomplete public-list read or be temporary readers.
  // Keep them addressable once, without turning them into editable/publishable rows.
  const urls = [...new Set([...rows.map(row => row.url), ...Object.keys(auth?.states ?? {})])];
  return <section className="relay-editor" aria-label="アカウントの公開リレー" aria-busy={busy}>
    {urls.map(url => {
      const index = rows.findIndex(row => row.url === url), row = rows[index], state = auth?.states[url];
      return <div className="relay-config" key={url}>
        <div className="relay-config-head"><span>{url.replace('wss://', '').replace(/\/$/, '')}</span><div className="relay-config-actions">
          {auth && state && <RelayAuthControl url={url} state={state} authenticate={auth.authenticate} onDismiss={auth.onDismiss}/>}
          {row && <M3eIconButton aria-label={`${url}を公開一覧から削除`} disabled={busy || !ready} onClick={() => {setRows(rows.filter((_, i) => i !== index)); setEmptyConfirmed(false);}}><Trash2/></M3eIconButton>}
        </div></div>
        <div className="relay-permissions">{row && (['read', 'write'] as const).map(permission => <label key={permission}><M3eCheckbox checked={row[permission]} disabled={busy || !ready} aria-label={`${url} ${permission}`} onChange={e => setRows(rows.map((r, i) => i === index ? {...r, [permission]: (e.target as HTMLElement & {checked: boolean}).checked} : r))}/>{permission}</label>)}
          {state && <small role="status" aria-label={`${url}の認証状態`}>{relayAuthLabels[state.status]}</small>}
        </div>
      </div>;
    })}
    {ready && <><div className="relay-add"><input aria-label="公開リレーのURL" placeholder="wss://relay.example.com" value={url} disabled={busy} onChange={e => setUrl(e.target.value)} onKeyDown={e => {if (e.key === 'Enter' && !busy) add();}}/><M3eIconButton aria-label="公開リレーを追加" disabled={busy || !url.trim() || rows.length >= 16} onClick={add}><Plus/></M3eIconButton></div>
      {!rows.length && <label><M3eCheckbox checked={emptyConfirmed} disabled={busy} onChange={e => setEmptyConfirmed((e.target as HTMLElement & {checked: boolean}).checked)}/>受信先・投稿先なしとして公開する</label>}</>}
    {error && <p role="alert">{error}</p>}{(busy || status) && <p role="status">{busy ? '確認中…' : status}</p>}
    <p className="relay-hint">確認・接続先にはIPアドレスが伝わります。</p>
    <M3eButton variant="filled" disabled={busy || !ready || !rows.length && !emptyConfirmed} onClick={() => void submit()}>署名して公開保存</M3eButton>
    <M3eButton disabled={busy} onClick={() => {if (!ready || window.confirm('入力を破棄して公開一覧を読み直しますか？')) void reload();}}>再読み込み</M3eButton>
  </section>;
}
