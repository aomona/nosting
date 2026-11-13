'use client';
import {M3eButton} from '@m3e/react/button';
import type {SearchResult} from '../lib/relay-search';
import Loading from './loading';
export default function SearchStatus({checking,result,onSettings}:{checking:boolean;result:SearchResult|null;onSettings:()=>void}){
 if(checking||result?.relays.some(r=>r.status==='loading'))return <Loading/>;
 if(!result)return null;
 const completed=result.relays.filter(r=>r.status==='complete'||r.status==='limited');
 const capable=result.relays.some(r=>r.support===true);
 const unknown=result.relays.some(r=>r.support==='unknown');
 const partial=result.relays.some(r=>r.status!=='complete')||result.limited;
 if(!capable&&!result.events.length)return <div className="relay-search-status" role="status"><p>{unknown?'検索への対応を確認できませんでした。接続を確認するか、検索可能なリレーを追加してください。':'検索可能なリレーがありません。検索可能なリレーを追加してください。'}</p><M3eButton variant="tonal" onClick={onSettings}>追加</M3eButton></div>;
 return <div className="relay-search-status" role="status"><p>{!completed.length&&!result.events.length?'検索が完了しませんでした。再試行してください。':result.events.length?`${result.events.length}件${partial?'（一部の結果）':''}`:partial?'取得できた範囲では投稿が見つかりませんでした':'この検索では投稿が見つかりませんでした'}</p></div>;
}
