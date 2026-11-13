/** Keep loaded history stable. At the budget, new network events are deferred until an explicit refresh. */
export const FEED_LIMIT=1200;
export function retainFeed<T extends {id:string;created_at:number}>(old:T[],incoming:T[],limit=FEED_LIMIT):T[]{
 const cap=Math.max(1,Math.floor(limit));
 const byId=new Map(old.slice(0,cap).map(n=>[n.id,n]));let changed=old.length>cap;
 for(const n of incoming){if(byId.has(n.id))continue;if(byId.size>=cap)break;byId.set(n.id,n);changed=true}
 return changed?[...byId.values()].sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)):old;
}
/** Bounded profile cache. Active account/author and retained notes are preferentially kept. */
export function retainProfiles<T>(old:Record<string,T>,key:string,value:T,pinned:ReadonlySet<string>,limit=2400){
 const next={...old,[key]:value};const keys=Object.keys(next);let excess=keys.length-limit;
 for(const k of keys){if(excess<=0)break;if(k===key||pinned.has(k))continue;delete next[k];excess--}
 // Hard bound even for adversarial/unbounded pin inputs; the freshly requested profile always survives.
 for(const k of keys){if(excess<=0)break;if(k===key||!(k in next))continue;delete next[k];excess--}
 return next;
}
