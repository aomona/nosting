'use client';
import {useEffect, useRef, useState} from 'react';
import {BookmarkSession, bookmarkKey, emptyBookmarkState} from '../lib/bookmarks';

export function useBookmarks(owner: string, urls: string[], visible: boolean) {
  const [state, setState] = useState(emptyBookmarkState);
  const session = useRef<BookmarkSession | null>(null);
  const relayKey = JSON.stringify(urls);
  useEffect(() => {
    const current = new BookmarkSession({getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value)}, setState);
    session.current = current;
    const load = () => {current.start(owner, JSON.parse(relayKey)); if (visible && !document.hidden) void current.refresh();};
    const refresh = () => {if (visible && !document.hidden) void current.refresh(); else current.stop();};
    const changed = (event: StorageEvent) => {if (event.key === bookmarkKey(owner) || event.key === null) load();};
    load();
    window.addEventListener('storage', changed);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      current.stop(); session.current = null; clearInterval(timer);
      window.removeEventListener('storage', changed); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner, relayKey, visible]);
  const scoped = state.owner === owner ? state : emptyBookmarkState(owner);
  return {...scoped, toggle: (id: string) => session.current?.state.owner === owner && session.current.toggle(id), refresh: () => {
    const current = session.current;
    if (current?.state.owner !== owner) return;
    if (!current.state.ready) current.start(owner, JSON.parse(relayKey));
    void current.refresh();
  }};
}
