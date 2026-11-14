import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {generateSecretKey,getPublicKey,finalizeEvent,nip44,verifyEvent} from 'nostr-tools';

await fs.mkdir('.sites-runtime',{recursive:true});
const dir=await fs.mkdtemp(resolve('.sites-runtime/remote-signer-'));
try {
  for(const name of ['remote-signer','signer','login-session']) {
    const code=ts.transpileModule(await fs.readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'./signer'","'./signer.mjs'");
    await fs.writeFile(`${dir}/${name}.mjs`,code);
  }
  const {RemoteSigner,parseBunker}=await import(pathToFileURL(`${dir}/remote-signer.mjs`));
  const {SignerSession}=await import(pathToFileURL(`${dir}/signer.mjs`));
  const {LoginSession}=await import(pathToFileURL(`${dir}/login-session.mjs`));
  const remoteSecret=generateSecretKey(),userSecret=generateSecretKey(),outsider=generateSecretKey();
  const remoteKey=getPublicKey(remoteSecret),userKey=getPublicKey(userSecret);
  const template={kind:1,content:'isolated test only',tags:[],created_at:Math.floor(Date.now()/1000)};
  const url=`bunker://${remoteKey}?relay=wss://signer.example&secret=test-token`;
  for(const input of ['',`nostrconnect://${remoteKey}?relay=wss://example.com`, `bunker://${remoteKey}`,`bunker://${remoteKey}?relay=https://example.com`, `bunker://${remoteKey}?relay=ws://public.example`, `bunker://${remoteKey}?relay=wss://user:pass@example.com`, `bunker://${remoteKey}/wrong?relay=wss://example.com`]) assert.throws(()=>parseBunker(input));
  assert.equal(parseBunker(`bunker://${remoteKey}?relay=ws://127.0.0.1:8080`).relays[0],'ws://127.0.0.1:8080/');
  assert.equal(parseBunker(`${url}&relay=wss://signer.example`).relays.length,1);
  const tick=()=>new Promise(r=>setTimeout(r,0));
  function fixture({handler,timeout=200,broken=false}={}) {
    const sockets=[],requests=[],authorizations=[];
    class Socket {
      readyState=0; sub=''; sent=[];
      constructor(url){this.url=url;sockets.push(this);queueMicrotask(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.()})}
      send(raw){const frame=JSON.parse(raw);this.sent.push(frame);if(frame[0]==='REQ')this.sub=frame[1];if(frame[0]!=='EVENT')return;const event=frame[1];assert(verifyEvent(event));assert.equal(event.kind,24133);const key=nip44.v2.utils.getConversationKey(remoteSecret,event.pubkey);const request=JSON.parse(nip44.v2.decrypt(event.content,key));requests.push(request);
        const reply=(result,extras={})=>{const response={id:request.id,result,...extras.response};const signer=extras.signer??remoteSecret;const signed=finalizeEvent({kind:24133,content:nip44.v2.encrypt(JSON.stringify(response),key),tags:[['p',extras.recipient??event.pubkey]],created_at:Math.floor(Date.now()/1000)},signer);if(extras.corrupt)signed.sig='0'.repeat(128);this.onmessage?.({data:JSON.stringify(['EVENT',extras.sub??this.sub,signed])})};
        if(handler?.({request,reply,socket:this,event})===false)return;
        if(request.method==='connect'){assert.equal(request.params[0],remoteKey);assert.equal(request.params[1],'test-token');assert.equal(JSON.parse(request.params[3]).name,'nost.ing');reply('ack')}
        else if(request.method==='get_public_key')reply(userKey);
        else if(request.method==='switch_relays')reply('null');
        else if(request.method==='sign_event')reply(JSON.stringify(finalizeEvent(JSON.parse(request.params[0]),userSecret)));
      }
      close(){this.readyState=3;this.onclose?.()}
    }
    const bunker=parseBunker(url);if(broken)bunker.relays.unshift('wss://broken.example/');
    const signer=new RemoteSigner(bunker,{timeoutMs:timeout,authorization:value=>authorizations.push(value),socket:url=>{if(url.includes('broken'))throw Error('offline');return new Socket(url)}});
    return {signer,sockets,requests,authorizations};
  }
  // Distinct transport/user identities; broken relay does not prevent login/signing.
  const f=fixture({broken:true}),session=new SignerSession();
  assert.equal(await session.connect(f.signer),userKey);assert.notEqual(userKey,remoteKey);
  assert.equal((await session.signEvent(template,userKey)).pubkey,userKey);
  assert.deepEqual(f.requests.map(r=>r.method),['connect','get_public_key','switch_relays','sign_event']);
  f.sockets[0].close();await session.signEvent(template,userKey);assert.equal(f.sockets.length,2);
  session.clear();assert(f.sockets.every(s=>s.readyState===3));await assert.rejects(session.signEvent(template,userKey));

  // Invalid signatures, authors, recipients, subscription IDs and request IDs are ignored.
  let release;
  const forged=fixture({handler:({request,reply})=>{if(request.method!=='get_public_key')return;reply(userKey,{signer:outsider});reply(userKey,{corrupt:true});reply(userKey,{recipient:remoteKey});reply(userKey,{sub:'wrong'});reply(userKey,{response:{id:'unknown'}});release=()=>reply(userKey);return false}});
  let finished=false;const connecting=forged.signer.getPublicKey().then(v=>{finished=true;return v});await tick();assert(!finished);release();assert.equal(await connecting,userKey);forged.signer.close();
  const tampered=fixture({handler:({request,reply})=>{if(request.method==='sign_event'){reply(JSON.stringify(finalizeEvent({...template,content:'changed'},userSecret)));return false}}});
  await tampered.signer.getPublicKey();await assert.rejects(tampered.signer.signEvent(template),/署名/);tampered.signer.close();
  const wrongOwner=fixture({handler:({request,reply})=>{if(request.method==='sign_event'){reply(JSON.stringify(finalizeEvent(template,remoteSecret)));return false}}});
  await wrongOwner.signer.getPublicKey();await assert.rejects(wrongOwner.signer.signEvent(template),/署名/);wrongOwner.signer.close();

  // Auth challenge survives until explicit approval; dangerous URLs fail closed.
  let approve;
  const auth=fixture({handler:({request,reply})=>{if(request.method==='connect'){reply('auth_url',{response:{error:'https://signer.example/approve'}});approve=()=>reply('ack');return false}}});
  const authLogin=auth.signer.getPublicKey();await tick();assert.equal(auth.authorizations.at(-1).url,'https://signer.example/approve');approve();assert.equal(await authLogin,userKey);assert.equal(auth.authorizations.at(-1),null);auth.signer.close();
  const unsafe=fixture({handler:({reply})=>{reply('auth_url',{response:{error:'javascript:alert(1)'}});return false}});await assert.rejects(unsafe.signer.getPublicKey(),/URL/);
  const denied=fixture({handler:({reply})=>{reply('',{response:{error:'denied secret must not leak'}});return false}});await assert.rejects(denied.signer.getPublicKey(),e=>!e.message.includes('secret'));
  const cancelAuth=fixture({handler:({request,reply})=>{if(request.method==='switch_relays'){reply('auth_url',{response:{error:'https://signer.example/approve'}});return false}}});const cancelledAuth=cancelAuth.signer.getPublicKey();await tick();cancelAuth.authorizations.at(-1).cancel();await assert.rejects(cancelledAuth,/中止/);

  // A timed-out/cancelled request cannot resolve a later request; reconnect is explicit and fresh.
  const timeout=fixture({timeout:15,handler:()=>false});await assert.rejects(timeout.signer.getPublicKey(),/応答/);assert(timeout.sockets.every(s=>s.readyState===3));
  let late;
  const cancelled=fixture({handler:({request,reply})=>{if(request.method==='connect'){late=()=>reply('ack');return false}}});
  const login=new LoginSession(),guard=new SignerSession();const old=login.login(()=>guard.connect(cancelled.signer),'profile');await tick();login.logout();guard.clear();late();assert.equal(await old,null);assert.equal(login.key,'');
  const fresh=fixture();assert.equal((await login.login(()=>guard.connect(fresh.signer),'notifications')).key,userKey);
  let oldSignature;const deferredSigner={getPublicKey:async()=>userKey,signEvent:()=>new Promise(r=>oldSignature=r)};
  await guard.connect(deferredSigner);const stale=guard.signEvent(template,userKey);await guard.connect(fixture().signer);oldSignature(finalizeEvent(template,userSecret));await assert.rejects(stale,/状態/);guard.clear();
  // NIP-07 maintains the common shape and content validation; no implicit signing at login.
  let signs=0;await guard.connect({getPublicKey:async()=>userKey,signEvent:async e=>{signs++;return finalizeEvent(e,userSecret)}});assert.equal(signs,0);await guard.signEvent(template,userKey);assert.equal(signs,1);guard.clear();
  // Main's DM/mute consumers receive only the selected signer, with epoch-bound encryption.
  let extensionKey=userKey,finishDecrypt,encryptCalls=0;
  const extension={getPublicKey:async()=>extensionKey,signEvent:async event=>finalizeEvent(event,userSecret),nip44:{encrypt:async(key,text)=>{encryptCalls++;return key+text},decrypt:()=>new Promise(resolve=>finishDecrypt=resolve)}};
  await guard.connect(extension);const adapter=guard.accountSigner(userKey);
  assert.equal(guard.accountSigner(remoteKey),undefined);assert.equal(await adapter.getPublicKey(),userKey);
  assert.equal(await adapter.nip44.encrypt(remoteKey,'test'),remoteKey+'test');
  assert.equal((await adapter.signEvent(template)).pubkey,userKey);
  const staleDecrypt=adapter.nip44.decrypt(remoteKey,'cipher');guard.clear();await guard.connect(extension);finishDecrypt('private');
  await assert.rejects(staleDecrypt,/状態/);await assert.rejects(adapter.nip44.encrypt(remoteKey,'stale'),/状態/);assert.equal(encryptCalls,1);
  const currentAdapter=guard.accountSigner(userKey);extensionKey=remoteKey;await assert.rejects(currentAdapter.getPublicKey(),/状態/);extensionKey=userKey;
  await guard.connect(fixture().signer);assert.equal(guard.accountSigner(userKey).nip44,undefined);guard.clear();assert.equal(guard.accountSigner(userKey),undefined);
  const cached=finalizeEvent(template,userSecret);assert(verifyEvent(cached));cached.sig='0'.repeat(128);
  await guard.connect({getPublicKey:async()=>userKey,signEvent:async()=>cached});await assert.rejects(guard.signEvent(template,userKey),/署名/);guard.clear();
  let lateSignature;
  const signingTimeout=fixture({timeout:20,handler:({request,reply})=>{if(request.method==='sign_event'){lateSignature=()=>reply(JSON.stringify(finalizeEvent(template,userSecret)));return false}}});
  await signingTimeout.signer.getPublicKey();await assert.rejects(signingTimeout.signer.signEvent(template),/応答/);lateSignature();signingTimeout.signer.close();
  const switcher=fixture({handler:({request,reply})=>{if(request.method==='switch_relays'){reply(JSON.stringify(['wss://new.example/']));return false}}});await switcher.signer.getPublicKey();await switcher.signer.signEvent(template);assert.equal(switcher.sockets.at(-1).url,'wss://new.example/');switcher.signer.close();
  const unsupported=fixture({handler:({request,reply})=>{if(request.method==='switch_relays'){reply('',{response:{error:'unsupported'}});return false}}});assert.equal(await unsupported.signer.getPublicKey(),userKey);unsupported.signer.close();
  console.log('PASS NIP-46 parser, NIP-44 wire format, distinct user key, partial failure, reconnect, response validation, signature binding, auth challenge/cancel, timeout, stale login/signature, NIP-07, relay switching');
} finally {await fs.rm(dir,{recursive:true,force:true})}
