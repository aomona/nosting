export function validTimestamp(seconds:number){return Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=8640000000000}
export function formatNoteTime(createdAt:number,now:number):string{
 if(!validTimestamp(createdAt)||!Number.isFinite(now)||now<=0)return '—';
 const date=new Date(createdAt*1000),today=new Date(now*1000),age=Math.floor(now-createdAt);
 const calendar=()=>`${date.getFullYear()!==today.getFullYear()?date.getFullYear()+'/':''}${date.getMonth()+1}/${date.getDate()}`;
 if(age< -60)return `${calendar()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
 if(age<10)return 'たった今';
 if(age<60)return `${age}秒前`;
 if(age<3600)return `${Math.floor(age/60)}分前`;
 if(age<86400)return `${Math.floor(age/3600)}時間前`;
 if(age<604800)return `${Math.floor(age/86400)}日前`;
 return calendar();
}
export function nextNoteTimeUpdate(createdAt:number,now:number){
 if(!validTimestamp(createdAt))return 60000;
 const age=now-createdAt;
 if(age< -60)return Math.min(60000,Math.max(1000,(-age-60)*1000));
 if(age<10)return Math.max(1000,(10-age)*1000);
 if(age<60)return Math.max(100,Math.ceil(age)-age===0?1000:(Math.ceil(age)-age)*1000);
 const unit=age<3600?60:age<86400?3600:86400;
 return Math.min(60000,Math.max(1000,(unit-age%unit)*1000));
}
