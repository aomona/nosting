'use client';
import {useEffect, useRef, useState, type ComponentRef} from 'react';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {Plus, RefreshCw} from 'lucide-react';
import {editableMute, type MuteEdit, type MuteType} from '../lib/account-mutes';
import type {useAccountMutes} from './use-account-mutes';
import MuteValue from './mute-value';
import './mute-settings.css';

const labels = {p: 'ユーザー', word: 'ワード', t: 'ハッシュタグ', e: 'スレッド'};
function AccountMuteGroup({tags,visibility,disabled,onRemove}:{tags:string[][];visibility:'public'|'private';disabled:boolean;onRemove:(edit:MuteEdit)=>Promise<void>}) {
 if (!tags.length) return null;
 return <div className="mute-group"><h4>{visibility === 'public' ? '公開' : '非公開'}<span>{tags.length}</span></h4><ul>{tags.map((tag,index)=><li key={`${index}:${tag.join(':')}`}><MuteValue value={tag[1]} label={labels[tag[0] as MuteType]} identifier={tag[0]==='p'||tag[0]==='e'}/><M3eButton disabled={disabled} aria-label={`${visibility === 'public' ? '公開' : '非公開'}の${tag[1]}を解除`} onClick={()=>void onRemove({scope:visibility,type:tag[0] as MuteType,value:tag[1],remove:true})}>解除</M3eButton></li>)}</ul></div>;
}

export default function AccountMuteSettings({list, ready, loading, error, reload, save}: ReturnType<typeof useAccountMutes>) {
 const [type, setType] = useState<MuteType>('p'), [scope, setScope] = useState<'private' | 'public'>('private'), [value, setValue] = useState('');
 const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failure, setFailure] = useState('');
 const previousEditing = useRef(false);
 const request = useRef<AbortController | null>(null), lock = useRef(false), input = useRef<HTMLInputElement>(null), add = useRef<ComponentRef<typeof M3eButton>>(null);
 useEffect(() => () => {request.current?.abort();}, []);
 useEffect(() => {if (editing) input.current?.focus(); else if (previousEditing.current) add.current?.focus(); previousEditing.current = editing;}, [editing]);
 function closeEditor() {setEditing(false); setValue(''); setFailure('');}
 async function submit(edit: MuteEdit) {
  if (lock.current || !ready) return;
  lock.current = true; setBusy(true); setMessage(''); setFailure(''); const controller = new AbortController(); request.current = controller;
  try {
   const result = await save(edit, controller.signal);
   if (controller.signal.aborted) return;
   if (result.confirmed) {
    setMessage(`${result.confirmed}/${result.total}か所で保存を確認${result.confirmed < result.total ? '（残りは未確認）' : ''}`);
    if (!edit.remove) closeEditor();
    // A complete refresh is still required before another edit; do it without an extra tap.
    await reload();
   } else setFailure('保存を確認できません。再読み込みしてください');
  } catch (e) {if (!controller.signal.aborted) setFailure(e instanceof Error ? e.message : '保存できません');}
  finally {if (!controller.signal.aborted) {lock.current = false; setBusy(false);}}
 }
 const disabled = busy || loading || !ready;
 const groups = {public: (list?.event?.tags ?? []).filter(editableMute), private: (list?.privateTags ?? []).filter(editableMute)};
 return <section className="petal-mute-settings account-mute-settings" aria-label="アカウントのミュート" aria-busy={busy || loading}>
  <div className="mute-toolbar"><h3>{editing ? '追加' : `${groups.public.length + groups.private.length}件`}</h3><div><M3eIconButton aria-label="再読み込み" title="再読み込み" disabled={busy || loading} onClick={() => {setFailure(''); void reload();}}><RefreshCw size={20}/></M3eIconButton>{!editing && <M3eButton ref={add} variant="tonal" disabled={disabled} onClick={() => {setEditing(true); setMessage(''); setScope('private');}}><Plus slot="icon" size={18}/>追加</M3eButton>}</div></div>
  {(failure || error) && <p className="mute-feedback" role="alert">{failure || error}</p>}{message && <p className="mute-feedback" role="status">{message}</p>}
  {loading && <p role="status">読み込み中…</p>}{busy && !loading && !editing && <p role="status">保存中…</p>}
  {editing ? <form className="mute-editor" onSubmit={e => {e.preventDefault(); void submit({scope, type, value});}}>
   <fieldset className="mute-scope"><legend>公開範囲</legend><div>{(['private', 'public'] as const).map(s => <M3eButton key={s} type="button" toggle selected={scope === s} onBeforeInput={e=>e.preventDefault()} disabled={busy || loading} variant={scope === s ? 'tonal' : 'outlined'} onClick={() => setScope(s)}>{s === 'private' ? '非公開' : '公開'}</M3eButton>)}</div></fieldset>
   <label htmlFor="account-mute-type">種類<select aria-label="種類" id="account-mute-type" value={type} disabled={busy || loading} onChange={e => {setType(e.target.value as MuteType); setFailure(''); input.current?.focus();}}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
   <label htmlFor="account-mute-value">{type === 'p' ? 'ユーザーの公開鍵' : type === 'e' ? 'スレッドの投稿ID' : labels[type]}<input ref={input} id="account-mute-value" value={value} disabled={busy || loading} maxLength={200} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={!!failure} onChange={e => setValue(e.target.value)}/></label>
   <div className="mute-editor-actions"><M3eButton type="button" disabled={busy} onClick={closeEditor}>キャンセル</M3eButton><M3eButton type="submit" variant="filled" disabled={disabled || !value.trim()}>{busy ? '保存中…' : scope === 'public' ? '公開して追加' : '追加'}</M3eButton></div>
  </form> : (['private', 'public'] as const).map(visibility => <AccountMuteGroup key={visibility} tags={groups[visibility]} visibility={visibility} disabled={disabled} onRemove={submit}/>)}
 </section>;
}
