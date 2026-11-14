'use client';
import {useEffect, useRef, useState} from 'react';
import {M3eButton} from '@m3e/react/button';
import {createFollowingFeed, emptyFollowing} from '../lib/following-feed';
import Loading from './loading';

export function useFollowingFeed(owner: string, authors: string[], relays: string[], enabled: boolean) {
  const key = JSON.stringify([owner, [...new Set(authors)].sort(), relays, enabled]);
  const [state, setState] = useState({key: '', snapshot: emptyFollowing});
  const [attempt, setAttempt] = useState(0);
  const session = useRef<ReturnType<typeof createFollowingFeed> | null>(null);
  useEffect(() => {
    const [account, keys, urls, active] = JSON.parse(key) as [string, string[], string[], boolean];
    if (!account || !active) return;
    const controller = createFollowingFeed(keys, urls, snapshot => setState({key, snapshot}));
    session.current = controller;
    return () => { controller.stop(); session.current = null; };
  }, [key, attempt]);
  return {
    state: state.key === key ? state.snapshot : {...emptyFollowing, loading: !!owner && enabled},
    loadOlder: (retry = false) => { void session.current?.loadOlder(retry); },
    refresh: () => setAttempt(value => value + 1),
  };
}

export function FollowingHistory({feed, auto = true}: {feed: ReturnType<typeof useFollowingFeed>; auto?: boolean}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const {state, loadOlder, refresh} = feed;
  useEffect(() => {
    if (!auto || state.initial || state.loading || state.done || state.limited || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loadOlder(); }, {rootMargin: '240px'});
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [auto, state, loadOlder]);
  return <div ref={sentinel} className="history-loader" aria-live="polite" aria-busy={state.loading}>
    {state.loading ? <Loading/> : state.limited ? <M3eButton onClick={refresh}>最新から読み直す</M3eButton> : <>
      {state.failed > 0 ? <><span>一部の投稿を読み込めませんでした</span><M3eButton variant="tonal" onClick={() => loadOlder(true)}>再試行</M3eButton></> : state.partial && <><span>一部の投稿が表示されない場合があります</span><M3eButton variant="text" onClick={refresh}>再読み込み</M3eButton></>}
      {state.done ? !state.failed && !state.partial && state.events.length > 0 && <span>これ以上の投稿はありません</span> : <M3eButton onClick={() => loadOlder()}>過去の投稿を読み込む</M3eButton>}
    </>}
  </div>;
}
