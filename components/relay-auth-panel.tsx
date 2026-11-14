'use client';
import {useEffect, useRef} from 'react';
import {M3eButton} from '@m3e/react/button';
import type {RelayAuthState, RelayAuthStatus} from '../lib/relay-auth';
const labels: Record<RelayAuthStatus, string> = {
  available: '認証できます', required: '認証が必要', signing: '署名を確認中…', waiting: '認証を確認中…',
  authenticated: '認証済み', restricted: 'アクセス制限', 'signing-rejected': '署名が拒否されました', rejected: '認証が拒否されました',
  invalid: '署名が不正です', stale: '認証要求が更新されました', 'account-changed': 'アカウントが変わりました',
  cancelled: '認証を中止しました', timeout: '認証がタイムアウトしました', exhausted: '認証の再試行上限',
};
export default function RelayAuthPanel({states, authenticate, onDismiss}: {
  states: Record<string, RelayAuthState>;
  onDismiss: () => void;
  authenticate: (url: string, signal: AbortSignal) => void;
}) {
  const requests = useRef(new Map<string, AbortController>());
  const root = useRef<HTMLElement>(null), dismiss = useRef(onDismiss);
  useEffect(() => {dismiss.current = onDismiss;}, [onDismiss]);
  useEffect(() => {
    const active = requests.current, dialog = root.current?.closest('m3e-dialog');
    const abort = () => {for (const controller of active.values()) controller.abort();};
    // Native M3E events also cover Escape/backdrop closure before React unmounts.
    const closing = () => {abort(); dismiss.current();};
    dialog?.addEventListener('closing', closing);
    return () => {dialog?.removeEventListener('closing', closing); abort();};
  }, []);
  return <section ref={root} hidden={!Object.keys(states).length} className="relay-editor" aria-label="リレー認証">
    {Object.entries(states).map(([url, state]) => <div className="relay-config" key={url}>
      <div className="relay-config-head"><span>{url.replace('wss://', '').replace(/\/$/, '')}</span></div>
      <div className="relay-permissions"><small role="status">{labels[state.status]}</small>
        {state.status === 'signing' || state.status === 'waiting'
          ? <M3eButton size="small" onClick={() => requests.current.get(url)?.abort()}>中止</M3eButton>
          : <M3eButton variant="tonal" size="small" disabled={!state.canAuthenticate} aria-label={`${url}に認証`} onClick={() => {
            requests.current.get(url)?.abort(); const controller = new AbortController(); requests.current.set(url, controller); authenticate(url, controller.signal);
          }}>認証</M3eButton>}
      </div>
    </div>)}
  </section>;
}
