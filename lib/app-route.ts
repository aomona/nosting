export type AppRoute = {view:'home'|'explore'|'notifications'|'saved'} | {view:'profile';id:string} | {view:'thread';id:string};
const idPattern=/^[a-f0-9]{64}$/;
export function parseRoute(hash:string):AppRoute {
 const parts=hash.replace(/^#\/?/,'').split('/');
 if((parts[0]==='profile'||parts[0]==='thread')&&idPattern.test(parts[1]||'')&&parts.length===2)return {view:parts[0],id:parts[1]};
 if(['home','explore','notifications','saved'].includes(parts[0])&&parts.length===1)return {view:parts[0] as 'home'};
 return {view:'home'};
}
export function routeHash(route:AppRoute){return '#/'+route.view+('id'in route?'/'+route.id:'')}
export type ScrollAnchor={id:string;offset:number};
export class RouteHistory {
 constructor(private host:Window,private apply:(route:AppRoute,y:number,anchor:ScrollAnchor|null)=>void){}
 private save=()=>{const s=this.host.history.state||{};const nodes=this.host.document?.querySelectorAll<HTMLElement>('article[data-note-id]')||[];let anchor:ScrollAnchor|null=null;for(const node of nodes){const box=node.getBoundingClientRect();if(box.bottom>80&&box.top<this.host.innerHeight){anchor={id:node.dataset.noteId!,offset:box.top};break}}this.host.history.replaceState({...s,petalY:this.host.scrollY,petalAnchor:anchor},'')};
 private restore=()=>{this.apply(parseRoute(this.host.location.hash),Number(this.host.history.state?.petalY)||0,this.host.history.state?.petalAnchor||null)};
 start(){const hash=routeHash(parseRoute(this.host.location.hash));this.host.history.replaceState(this.host.history.state||{},'',hash);this.host.history.scrollRestoration='manual';this.host.addEventListener('popstate',this.restore);this.host.addEventListener('hashchange',this.onHash);this.host.addEventListener('scroll',this.save,{passive:true});this.restore();return ()=>{this.host.removeEventListener('popstate',this.restore);this.host.removeEventListener('hashchange',this.onHash);this.host.removeEventListener('scroll',this.save);this.host.history.scrollRestoration='auto'}}
 // popstate is also emitted on hash traversal; apply once per destination.
 private onHash=()=>{if(this.host.location.hash!==this.lastHash)this.restore()};
 private lastHash='';
 mark(){this.lastHash=this.host.location.hash}
 push(route:AppRoute,anchor?:ScrollAnchor){const hash=routeHash(route);if(hash===this.host.location.hash)return;this.save();if(anchor)this.host.history.replaceState({...this.host.history.state,petalAnchor:anchor},'');this.host.history.pushState({...this.host.history.state,petalY:0,petalAnchor:null,petalBack:true},'',hash);this.lastHash=hash}
 back(){if(this.host.history.state?.petalBack){this.host.history.back();return true}return false}
}
