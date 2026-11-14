"""Mock-only DM UI: request privacy, retry identity, acknowledgement details and account isolation."""
from playwright.sync_api import sync_playwright
import os, shutil, json, re
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for width,height in [(1280,1000),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4175') else r.abort())
  page.goto('http://127.0.0.1:4175/tests/browser/direct-messages.html')
  page.get_by_role('button',name='DMを読み込む',exact=True).click()
  page.get_by_role('status').filter(has_text='読み込みました').wait_for(state='attached')
  assert 'こんにちは' not in page.locator('body').inner_text()
  page.get_by_role('button',name=re.compile('^受信要求')).click()
  assert page.locator('.dm-request').count()==1
  assert 'こんにちは' not in page.locator('body').inner_text()
  page.screenshot(path=f'/tmp/nosting-issue26-compact-{width}-requests.png')
  page.locator('.dm-request').get_by_role('button',name='許可',exact=True).click()
  page.get_by_text('こんにちは。明日の読書会は14時からでどうでしょう？').wait_for()
  assert page.locator('#dm-peer').count()==0
  page.locator('#dm-text').fill('14時で大丈夫です。楽しみにしています！')
  page.evaluate('qa.rejectRecipient=true')
  page.get_by_role('button',name='暗号化して送信',exact=True).click()
  page.locator('.dm-status p').filter(has_text='相手 0/1・自分 1/1').wait_for()
  assert page.get_by_role('button',name='同じDMを再送',exact=True).is_visible()
  assert page.get_by_role('button',name='新規会話',exact=True).get_attribute('disabled') is not None
  page.evaluate('qa.rejectRecipient=false')
  page.get_by_role('button',name='同じDMを再送',exact=True).click()
  page.get_by_role('status').filter(has_text='送信を確認しました').wait_for(state='attached')
  assert page.locator('.dm-status p').count()==0
  page.get_by_role('button',name='操作結果の詳細',exact=True).click()
  page.locator('.dm-status p').filter(has_text='相手 1/1・自分 1/1').wait_for()
  page.get_by_role('button',name='操作結果の詳細',exact=True).click()
  assert page.evaluate("new Set(qa.sent.filter(e=>e.eventKind===1059&&e.url==='wss://bob.example/').map(e=>e.eventId)).size===1")
  assert page.locator('.dm-message').count()==2
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.evaluate("Object.keys(localStorage).every(k=>!localStorage[k].includes('読書会')&&!localStorage[k].includes('楽しみ'))")
  page.evaluate('qa.hold=true')
  page.get_by_role('button',name='DMを更新',exact=True).click()
  page.get_by_role('button',name='中断',exact=True).click()
  page.locator('.dm-status p').filter(has_text='中断しました。送信開始後は届いている場合があります。').wait_for()
  page.evaluate('qa.switchAccount()')
  assert page.locator('.dm-message').count()==0
  assert page.locator('#dm-text').count()==0
  page.get_by_role('button',name='新規会話',exact=True).click()
  assert page.locator('#dm-peer').input_value()==''
  assert not errors,errors
  results.append({'width':width,'request_privacy':True,'retry_same_event':True,'receipt_details':True,'no_plaintext_storage':True,'cancel':True,'account_switch':True,'errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
