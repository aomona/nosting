import {nip19} from 'nostr-tools';
type ShareNote={id:string;pubkey:string};
export function noteShareUri(note:ShareNote){
 if(!/^[a-f0-9]{64}$/.test(note.id)||!/^[a-f0-9]{64}$/.test(note.pubkey))throw Error('投稿の参照を作れませんでした');
 return 'nostr:'+nip19.neventEncode({id:note.id,author:note.pubkey,kind:1});
}
type ShareAPI={share?:(data:{text:string})=>Promise<void>;canShare?:(data:{text:string})=>boolean;copy:(text:string)=>Promise<void>};
export async function shareNote(note:ShareNote,api:ShareAPI):Promise<'shared'|'copied'|'cancelled'>{
 const text=noteShareUri(note),data={text};
 if(api.share&&(!api.canShare||api.canShare(data))){try{await api.share(data);return 'shared'}catch(e:any){if(e?.name==='AbortError')return 'cancelled';if(e?.name!=='NotSupportedError')throw e}}
 await api.copy(text);return 'copied';
}
