'use client';
import {M3eButton} from '@m3e/react/button';
import {M3eIconButton} from '@m3e/react/icon-button';
import {RefreshCw} from 'lucide-react';
import type {BookmarkState} from '../lib/bookmarks';
export default function BookmarkStatus({state, refresh, remove}: {state: BookmarkState; refresh: () => void; remove: (id: string) => void}) {
  const unavailable = state.items.filter(item => item.status !== 'ready');
  const hasArticles = state.data.event?.tags.some(tag => tag[0] === 'a');
  const summary = [state.loading && '取得中', state.error, state.partial && '一部リレー取得失敗', state.data.event?.content && '非公開は未対応', hasArticles && '記事は未対応'].filter(Boolean).join(' · ');
  const labels = {pending: '未取得', ready: '', missing: '見つかりません', failed: '取得失敗', deleted: '削除済み'};
  return <section className="bookmark-status" aria-label="ブックマークの同期">
    <div className="bookmark-toolbar"><span className="bookmark-summary" role="status">{summary}</span><M3eIconButton aria-label="再取得" title="再取得" disabled={state.loading} onClick={refresh}><RefreshCw size={20}/></M3eIconButton></div>
    {state.ready && !state.data.event?.content && !hasArticles && !state.loading && !state.partial && !state.error && !state.items.length && <p role="status">ブックマークはまだありません</p>}
    {unavailable.length > 0 && <ul>{unavailable.map(item => <li key={item.id}><code title={item.id}>{item.id.slice(0, 8)}…{item.id.slice(-4)}</code><span>{labels[item.status]}</span><M3eButton variant="text" aria-label={`${item.id}をこの端末から解除`} onClick={() => remove(item.id)}>解除</M3eButton></li>)}</ul>}
  </section>;
}
