import type {LoginSession,LoginResult} from './login-session';
export const LOGIN_REMEMBER_KEY='petal-login-remember';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
/** Only a boolean preference, never a key, token, or signature. */
export function rememberedLogin(storage:Store):boolean{try{return storage.getItem(LOGIN_REMEMBER_KEY)==='1'}catch{return false}}
export function rememberLogin(storage:Store,remember:boolean):void{try{if(remember)storage.setItem(LOGIN_REMEMBER_KEY,'1');else storage.removeItem(LOGIN_REMEMBER_KEY)}catch{}}
export async function restoreLogin(session:LoginSession,storage:Store,extension?:{getPublicKey?:()=>Promise<unknown>}):Promise<LoginResult|null>{
 if(!rememberedLogin(storage)||typeof extension?.getPublicKey!=='function')return null;
 try{return await session.login(()=>extension.getPublicKey!())}catch{return null}
}
