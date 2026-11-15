'use client';
import {useEffect, useRef} from 'react';
import {M3eButton} from '@m3e/react/button';
import type {RelayAuthState, RelayAuthStatus} from '../lib/relay-auth';
export const relayAuthLabels: Record<RelayAuthStatus, string> = {
  available: '認証できます', required: '認証が必要', signing: '署名を確認中…', waiting: '認証を確認中…',
  authenticated: '認証済み', restricted: 'アクセス制限', 'signing-rejected': '署名が拒否されました', rejected: '認証が拒否されました',
  invalid: '署名が不正です', stale: '認証要求が更新されました', 'account-changed': 'アカウントが変わりました',
  cancelled: '認証を中止しました', timeout: '認証がタイムアウトしました', exhausted: '認証の再試行上限',
};
export type RelayAuthActions = {
  states: Record<string, RelayAuthState>;
  onDismiss: () => void;
  authenticate: (url: string, signal: AbortSignal) => void;
};
export default function RelayAuthControl({url, state, authenticate, onDismiss}: {
  url: string;
  state: RelayAuthState;
} & Omit<RelayAuthActions, 'states'>) {
  const request = useRef<AbortController | null>(null);
  const root = useRef<HTMLSpanElement>(null), dismiss = useRef(onDismiss);
  useEffect(() => {dismiss.current = onDismiss;}, [onDismiss]);
  useEffect(() => {
    const dialog = root.current?.closest('m3e-dialog');
    const abort = () => request.current?.abort();
    // Native M3E events cover Escape/backdrop closure before React unmounts.
    const closing = () => {abort(); dismiss.current();};
    dialog?.addEventListener('closing', closing);
    return () => {dialog?.removeEventListener('closing', closing); abort();};
  }, []);
  const pending = state.status === 'signing' || state.status === 'waiting';
  return <span ref={root} hidden={!pending && !state.canAuthenticate}>
    {pending
      ? <M3eButton size="small" aria-label={`${url}の認証を中止`} onClick={() => request.current?.abort()}>中止</M3eButton>
      : <M3eButton variant="tonal" size="small" disabled={!state.canAuthenticate} aria-label={`${url}に認証`} onClick={() => {
        request.current?.abort(); const controller = new AbortController(); request.current = controller; authenticate(url, controller.signal);
      }}>認証</M3eButton>}
  </span>;
}
