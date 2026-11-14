/** Move to one adjacent card boundary, clamping the final step to the viewport. */
export function mediaScrollTarget(position:number,offsets:number[],maximum:number,direction:-1|1):number{
 const end=Math.max(0,maximum),current=Math.max(0,Math.min(position,end));
 const stops=offsets.map(offset=>Math.max(0,Math.min(offset,end)));
 return direction===1?stops.find(stop=>stop>current+1)??end:stops.findLast(stop=>stop<current-1)??0;
}
