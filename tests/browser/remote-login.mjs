// Run with the dev server on 127.0.0.1:5173. Browser dependency is deliberately optional:
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/remote-login.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {WebSocketServer} from 'ws';
import {generateSecretKey,getPublicKey,finalizeEvent,nip44,verifyEvent} from 'nostr-tools';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const artifacts=process.env.SCREENSHOT_DIR || '/tmp/nosting-issue25';
await fs.mkdir(artifacts,{recursive:true});
const transportSecret=generateSecretKey(),userSecret=generateSecretKey();
const transportKey=getPublicKey(transportSecret),userKey=getPublicKey(userSecret);
const now=()=>Math.floor(Date.now()/1000);
const signed=(kind,content,tags=[])=>finalizeEvent({kind,content,tags,created_at:now()},userSecret);
const relayList=signed(10002,'',[['r','wss://mock-relay.example/']]);
const profile=signed(0,JSON.stringify({name:'mock-signer',display_name:'テストアカウント'}));
const note=signed(1,'ローカル検証用のノートです。');
const relay=new WebSocketServer({host:'127.0.0.1',port:0});
await new Promise(r=>relay.once('listening',r));
let approve, delayedSign, holdSign=false,challengeSign=false;
const methods=[],published=[];
relay.on('connection',socket=>{let subscription;
  socket.on('message',raw=>{const frame=JSON.parse(raw.toString());if(frame[0]==='REQ'){subscription=frame[1];socket.send(JSON.stringify(['EOSE',subscription]));return}if(frame[0]!=='EVENT')return;
    const event=frame[1];assert.equal(event.kind,24133);assert(verifyEvent(event));
    const key=nip44.v2.utils.getConversationKey(transportSecret,event.pubkey),request=JSON.parse(nip44.v2.decrypt(event.content,key));methods.push(request.method);
    const reply=(result,error)=>{if(socket.readyState!==1)return;const eventResponse=finalizeEvent({kind:24133,created_at:now(),tags:[['p',event.pubkey]],content:nip44.v2.encrypt(JSON.stringify({id:request.id,result,...(error?{error}:{})}),key)},transportSecret);socket.send(JSON.stringify(['EVENT',subscription,eventResponse]));};
    if(request.method==='connect'){reply('auth_url','https://signer.example/approve');approve=()=>reply('ack')}
    if(request.method==='get_public_key')reply(userKey);
    if(request.method==='switch_relays')reply('null');
    if(request.method==='sign_event'){const complete=()=>reply(JSON.stringify(finalizeEvent(JSON.parse(request.params[0]),userSecret)));if(holdSign)delayedSign=complete;else if(challengeSign){reply('auth_url','https://signer.example/approve');approve=complete}else complete()}
  });
});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await context.exposeBinding('approveRemote',()=>approve());
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.continue();if(url.href==='https://signer.example/approve')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<button onclick="window.approveRemote().then(()=>window.close())">モック署名を許可</button>'});return route.abort()});
  // Every application relay is intercepted. Only the isolated signing socket reaches a server.
  await context.routeWebSocket(/.*/,socket=>{
    if(socket.url().startsWith(`ws://127.0.0.1:${relay.address().port}`)){socket.connectToServer();return}
    if(socket.url().startsWith('ws://127.0.0.1:5173')){socket.connectToServer();return}
    socket.onMessage(raw=>{const frame=JSON.parse(String(raw));if(frame[0]==='REQ'){const id=frame[1],filters=frame.slice(2);for(const event of [relayList,profile,note])if(filters.some(f=>(!f.kinds||f.kinds.includes(event.kind))&&(!f.authors||f.authors.includes(event.pubkey))&&(!f.ids||f.ids.includes(event.id))))socket.send(JSON.stringify(['EVENT',id,event]));socket.send(JSON.stringify(['EOSE',id]));}
      if(frame[0]==='EVENT'){assert(verifyEvent(frame[1]));published.push(frame[1]);socket.send(JSON.stringify(['OK',frame[1].id,true,'mock accepted']));}
    });
  });
  const page=await context.newPage();
  page.on('console',message=>{if(message.type()==='error')console.log('browser error:',message.text())});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button',{name:'ログイン',exact:true}).click();
  await page.getByLabel('bunker 接続URL').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({path:`${artifacts}/mobile-login.png`});
  const token=`bunker://${transportKey}?relay=ws://127.0.0.1:${relay.address().port}&secret=mock-token`;
  await page.getByLabel('bunker 接続URL').fill(token);
  await page.getByRole('button',{name:'リモート署名で接続',exact:true}).click();
  await page.getByRole('link',{name:'署名サービスで承認する'}).waitFor();
  assert.equal(await page.getByLabel('bunker 接続URL').inputValue(),'');
  await page.screenshot({path:`${artifacts}/mobile-approval.png`});
  const popupPromise=context.waitForEvent('page');
  await page.getByRole('link',{name:'署名サービスで承認する'}).click();
  const popup=await popupPromise;await popup.getByRole('button',{name:'モック署名を許可'}).click();
  await page.bringToFront();
  await page.locator('.header-account-button:not(.login-entry)').waitFor({state:'attached'});
  await page.getByLabel('投稿本文').fill('隔離されたモックリレーへの署名テスト');
  await page.getByRole('button',{name:'投稿',exact:true}).click();
  await page.getByText('リレーが投稿を受け付けました',{exact:true}).waitFor();
  assert.equal(published.length,1);assert.equal(published[0].pubkey,userKey);assert.notEqual(userKey,transportKey);
  assert.equal(await page.evaluate(()=>localStorage.getItem('petal-login-remember')),null);
  await page.screenshot({path:`${artifacts}/mobile-connected.png`});
  // Logout while a signature is outstanding, then reconnect the same account.
  holdSign=true;
  await page.getByLabel('投稿本文').fill('ログアウトで破棄する署名');
  await page.getByRole('button',{name:'投稿',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('m3e-button')!==null);
  for(let i=0;i<100&&!delayedSign;i++)await new Promise(r=>setTimeout(r,20));assert(delayedSign);
  await page.locator('.mobile-header-settings').click();
  await page.getByText('ログアウト',{exact:true}).click();
  delayedSign();
  await page.getByText('リモート署名で接続',{exact:true}).click();
  await page.getByLabel('bunker 接続URL').fill(token);
  await page.getByRole('button',{name:'リモート署名で接続',exact:true}).click();
  await page.getByRole('link',{name:'署名サービスで承認する'}).waitFor();
  await page.getByRole('button',{name:'接続を中止',exact:true}).click();
  approve();
  assert.equal(await page.locator('.header-account-button:not(.login-entry)').count(),0);
  await page.getByLabel('bunker 接続URL').fill(token);
  await page.getByRole('button',{name:'リモート署名で接続',exact:true}).click();
  await page.getByRole('link',{name:'署名サービスで承認する'}).waitFor();approve();
  await page.locator('.header-account-button:not(.login-entry)').waitFor({state:'attached'});
  assert.equal(published.length,1);
  // An auth challenge remains actionable inside the profile editor's modal.
  holdSign=false;challengeSign=true;
  await page.locator('m3e-nav-bar').getByText('プロフィール',{exact:true}).click();
  await page.getByRole('button',{name:'編集',exact:true}).click();
  await page.getByLabel('表示名',{exact:true}).fill('ローカル変更');
  await page.getByRole('button',{name:'署名して保存',exact:true}).click();
  const approveLink=page.getByRole('link',{name:'署名サービスで承認する'});
  await approveLink.waitFor();
  const signPopupPromise=context.waitForEvent('page');await approveLink.click();
  const signPopup=await signPopupPromise;await signPopup.getByRole('button',{name:'モック署名を許可'}).click();
  await page.bringToFront();await page.getByText('プロフィールを保存しました',{exact:true}).waitFor();
  assert.equal(published.length,2);assert.equal(published[1].kind,0);assert.equal(published[1].pubkey,userKey);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS mobile bunker login, auth challenge, distinct identity, signed mock publication, logout during signing, cancel, same-account reconnect, modal signing approval; zero public relay traffic.');
  console.log(`Screenshots: ${artifacts}`);
} finally {await browser.close();for(const client of relay.clients)client.terminate();await new Promise(r=>relay.close(r));transportSecret.fill(0);userSecret.fill(0)}
