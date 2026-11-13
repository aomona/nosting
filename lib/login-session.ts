/** NIP-07 public-key acquisition only. Never signs or bypasses extension consent. */
export type LoginDestination='profile'|'notifications';
export type LoginResult={key:string;destination:LoginDestination|null};
const validKey=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class LoginSession{
 private currentKey='';private epoch=0;
 private flight:Promise<LoginResult|null>|null=null;
 private destination:LoginDestination|null=null;
 constructor(initialKey=''){if(initialKey&&!validKey(initialKey))throw Error('公開鍵が不正です');this.currentKey=initialKey}
 get key(){return this.currentKey}
 get pending(){return this.flight!==null}
 /** Explicit navigation updates the one pending destination, not a queue. */
 setDestination(destination:LoginDestination|null){this.destination=destination}
 /** Moving elsewhere must not be undone by an extension prompt resolving later. */
 cancelDestination(){this.destination=null}
 /** Invalidate an unresolved prompt without forgetting an existing login. */
 cancel(){this.epoch++;this.flight=null;this.destination=null}
 logout(){this.cancel();this.currentKey=''}
 login(getPublicKey:()=>Promise<unknown>,destination?:LoginDestination):Promise<LoginResult|null>{
  if(destination!==undefined)this.destination=destination;
  if(this.currentKey){const result={key:this.currentKey,destination:destination??null};this.destination=null;return Promise.resolve(result)}
  if(this.flight)return this.flight;
  const epoch=this.epoch;
  // Defer invocation one microtask so all synchronous clicks share this flight,
  // including implementations that throw synchronously rather than rejecting.
  const promise=Promise.resolve().then(()=>{if(epoch!==this.epoch)return null;return getPublicKey()}).then(value=>{
   if(epoch!==this.epoch)return null;
   if(!validKey(value))throw Error('署名拡張機能から有効な公開鍵を取得できませんでした');
   this.currentKey=value;const result={key:value,destination:this.destination};this.destination=null;return result;
  }).catch(error=>{if(epoch!==this.epoch)return null;throw error}).finally(()=>{if(this.flight===promise){this.flight=null;this.destination=null}});
  this.flight=promise;return promise;
 }
}
