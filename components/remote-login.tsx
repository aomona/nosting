'use client';
import {useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import {M3eFormField} from '@m3e/react/form-field';
import {RemoteSigner, parseBunker, type SignerAuthorization} from '../lib/remote-signer';
import './remote-login.css';

export function RemoteAuthorization({authorization}: {authorization: SignerAuthorization}) {
  if (!authorization) return null;
  return <div className="remote-authorization" role="status">
    <a href={authorization.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">署名サービスで承認する</a>
    <M3eButton variant="text" onClick={authorization.cancel}>中止</M3eButton>
  </div>;
}

export default function RemoteLogin({pending, onConnect, onExtension, onCancel, authorization, onAuthorization}: {
  pending: boolean; onConnect: (signer: RemoteSigner) => void; onExtension: () => void; onCancel: () => void;
  authorization: SignerAuthorization; onAuthorization: (value: SignerAuthorization) => void;
}) {
  const [token, setToken] = useState(''), [error, setError] = useState('');
  function connect() {
    if (pending) return;
    try {
      const signer = new RemoteSigner(parseBunker(token), {authorization: onAuthorization});
      setError(''); setToken(''); onConnect(signer);
    } catch (error) { setError((error as Error).message); }
  }
  return <section className="remote-login" aria-label="リモート署名">
    <M3eFormField variant="outlined"><label slot="label" htmlFor="bunker-token">bunker 接続URL</label>
      <input id="bunker-token" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={token} disabled={pending}
        onChange={event => setToken(event.target.value)} onKeyDown={event => {if (event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault(); connect();}}}/>
    </M3eFormField>
    <p className="remote-login-hint">署名アプリの bunker:// に対応。nostrconnect:// は未対応です。接続はこのタブのみ。</p>
    {error && <p role="alert">{error}</p>}
    <RemoteAuthorization authorization={authorization}/>
    <div className="remote-login-actions"><M3eButton variant="filled" disabled={pending || !token.trim()} onClick={connect}>{pending ? '接続中…' : 'リモート署名で接続'}</M3eButton>
      {pending ? <M3eButton variant="text" onClick={onCancel}>接続を中止</M3eButton> : <M3eButton variant="text" onClick={onExtension}>拡張機能で接続</M3eButton>}
    </div>
  </section>;
}
