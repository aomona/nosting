import {nextNoteTimeUpdate} from './note-time';
type Entry={createdAt:number;next:number;callback:(now:number)=>void};
/** One timer and one visibility listener for every mounted time label. */
export class NoteClock{
 private entries=new Set<Entry>();private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(private env:{now:()=>number;hidden:()=>boolean;listen:(callback:()=>void)=>()=>void;setTimer:typeof setTimeout;clearTimer:typeof clearTimeout}){}
 private unlisten?:()=>void;
 private stopTimer(){if(this.timer!==undefined)this.env.clearTimer(this.timer);this.timer=undefined}
 private schedule(){this.stopTimer();if(!this.entries.size||this.env.hidden())return;const delay=Math.max(100,Math.min(...[...this.entries].map(e=>e.next))-this.env.now()*1000);this.timer=this.env.setTimer(()=>this.tick(),delay)}
 private tick(force=false){this.stopTimer();if(this.env.hidden())return;const now=this.env.now();for(const e of this.entries){if(force||e.next<=now*1000+10){e.callback(now);e.next=now*1000+nextNoteTimeUpdate(e.createdAt,now)}}this.schedule()}
 subscribe(createdAt:number,callback:(now:number)=>void){const now=this.env.now(),entry={createdAt,callback,next:now*1000+nextNoteTimeUpdate(createdAt,now)};this.entries.add(entry);callback(now);if(!this.unlisten)this.unlisten=this.env.listen(()=>this.tick(true));this.schedule();let ended=false;return()=>{if(ended)return;ended=true;this.entries.delete(entry);if(!this.entries.size){this.stopTimer();this.unlisten?.();this.unlisten=undefined}else this.schedule()}}
}
let shared:NoteClock|undefined;
export function subscribeNoteTime(createdAt:number,callback:(now:number)=>void){
 if(typeof document==='undefined')return()=>{};
 shared??=new NoteClock({now:()=>Date.now()/1000,hidden:()=>document.hidden,listen:fn=>{document.addEventListener('visibilitychange',fn);return()=>document.removeEventListener('visibilitychange',fn)},setTimer:((...args:Parameters<typeof setTimeout>)=>setTimeout(...args)) as typeof setTimeout,clearTimer:((timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer)) as typeof clearTimeout});
 return shared.subscribe(createdAt,callback);
}
