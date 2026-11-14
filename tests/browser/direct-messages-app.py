from playwright.sync_api import sync_playwright
import shutil
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 for w,h in [(1280,1000),(390,844)]:
  page=b.new_page(viewport={'width':w,'height':h})
  errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4175') else r.abort())
  page.goto('http://127.0.0.1:4175/tests/browser/direct-messages.html?full=1')
  page.locator('m3e-button').filter(has_text='DMを読み込む').click()
  page.get_by_role('status').filter(has_text='読み込みました').wait_for()
  page.locator('m3e-button').filter(has_text='受信要求').click()
  page.locator('.dm-request m3e-button').filter(has_text='許可').click()
  page.locator('#dm-text').fill('14時で大丈夫です。楽しみにしています！')
  page.locator('m3e-button').filter(has_text='暗号化して送信').click()
  page.get_by_role('status').filter(has_text='相手 1/1・自分 1/1').wait_for()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-issue26-{w}-app.png',full_page=True)
  assert not errors,errors
  page.close()
 b.close()
 print('Full app route / navigation / DM send at 1280 and 390px passed; all HTTP outside localhost blocked.')
