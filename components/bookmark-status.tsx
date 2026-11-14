'use client';
import {M3eButton} from '@m3e/react/button';
import type {BookmarkState} from '../lib/bookmarks';
import Loading from './loading';
export default function BookmarkStatus({state, refresh, remove}: {state: BookmarkState; refresh: () => void; remove: (id: string) => void}) {
  const unavailable = state.items.filter(item => item.status !== 'ready');
  const hasArticles = state.data.event?.tags.some(tag => tag[0] === 'a');
  const labels = {pending: '未取得', ready: '', missing: '見つかりません', failed: '取得失敗', deleted: '削除済み'};
  return <section className="bookmark-status" aria-label="ブックマークの同期">
    <div className="bookmark-toolbar"><M3eButton variant="tonal" disabled={state.loading} onClick={refresh}>再取得</M3eButton>{state.loading && <Loading/>}</div>
    <div role="status">{state.error && <p>{state.error}</p>}{state.partial && <p>一部のリレーから取得できませんでした</p>}
    {!!state.data.event?.content && <p>非公開ブックマークは未対応です</p>}
    {hasArticles && <p>記事ブックマークは未対応です</p>}
    {state.ready && !state.data.event?.content && !hasArticles && !state.loading && !state.partial && !state.error && !state.items.length && <p>ブックマークはまだありません</p>}</div>
    {unavailable.length > 0 && <ul>{unavailable.map(item => <li key={item.id}><code title={item.id}>{item.id.slice(0, 8)}…{item.id.slice(-4)}</code><span>{labels[item.status]}</span><M3eButton variant="text" aria-label={`${item.id}をこの端末から解除`} onClick={() => remove(item.id)}>解除</M3eButton></li>)}</ul>}
  </section>;
}
