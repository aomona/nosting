export type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function draftKey(owner:string,target='post'){return `petal-draft:v1:${/^[a-f0-9]{64}$/.test(owner)?owner:'guest'}:${target==='post'?'post':/^(?:quote:)?[a-f0-9]{64}$/.test(target)?target:'post'}`}
export function readDraft(storage:DraftStorage,key:string){try{return (storage.getItem(key)||'').slice(0,4000)}catch{return ''}}
export function writeDraft(storage:DraftStorage,key:string,text:string){try{if(text)storage.setItem(key,text.slice(0,4000));else storage.removeItem(key);return true}catch{return false}}
export function clearSentDraft(storage:DraftStorage,key:string,sent:string){if(readDraft(storage,key)===sent)return writeDraft(storage,key,'');return false}
