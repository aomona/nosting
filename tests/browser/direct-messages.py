"""Mock-only DM UI; no external HTTP or real WebSockets. Images live in /tmp."""
from playwright.sync_api import sync_playwright
import os, shutil, json
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for width,height in [(1280,1000),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4175') else r.abort())
  page.goto('http://127.0.0.1:4175/tests/browser/direct-messages.html')
  page.locator('m3e-button').filter(has_text='DMを読み込む').click()
  page.get_by_role('status').filter(has_text='読み込みました').wait_for()
  assert 'こんにちは' not in page.locator('body').inner_text()
  page.locator('m3e-button').filter(has_text='受信要求').click()
  assert page.locator('.dm-request').count()==1
  assert 'こんにちは' not in page.locator('body').inner_text()
  page.screenshot(path=f'/tmp/nosting-issue26-{width}-requests.png')
  page.locator('.dm-request m3e-button').filter(has_text='許可').click()
  page.get_by_text('こんにちは。明日の読書会は14時からでどうでしょう？').wait_for()
  page.locator('#dm-text').fill('14時で大丈夫です。楽しみにしています！')
  page.locator('m3e-button').filter(has_text='暗号化して送信').click()
  page.get_by_role('status').filter(has_text='相手 1/1・自分 1/1').wait_for()
  assert page.locator('.dm-message').count()==2
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.evaluate("Object.keys(localStorage).every(k=>!localStorage[k].includes('読書会')&&!localStorage[k].includes('楽しみ'))")
  page.screenshot(path=f'/tmp/nosting-issue26-{width}-conversation.png',full_page=True)
  page.evaluate('qa.hold=true')
  page.locator('m3e-button').filter(has_text='更新').click()
  page.locator('m3e-button').filter(has_text='中断').click()
  page.get_by_role('status').filter(has_text='中断しました').wait_for()
  page.evaluate('qa.switchAccount()')
  assert page.locator('.dm-message').count()==0
  assert page.locator('#dm-peer').input_value()==''
  assert page.locator('#dm-text').input_value()==''
  assert not errors,errors
  results.append({'width':width,'request_privacy':True,'send':True,'no_plaintext_storage':True,'cancel':True,'account_switch':True,'overflow':False,'errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
