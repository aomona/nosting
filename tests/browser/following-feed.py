from playwright.sync_api import sync_playwright
import json
import os
import shutil
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for width,height in [(1280,900),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4175') else route.abort())
  page.goto('http://127.0.0.1:4175/tests/browser/following-feed.html')
  page.wait_for_function("document.querySelectorAll('[data-note-id]').length>=45")
  assert page.get_by_text('フォロー相手の古い投稿 1',exact=False).count()==0
  page.locator('.header-account-button').click()
  page.wait_for_function("document.querySelector('.header-account-button').textContent==='アカウント'")
  page.wait_for_timeout(300)
  page.locator('.tabs m3e-button').nth(1).click()
  page.get_by_text('フォロー相手の古い投稿 1',exact=False).first.wait_for()
  page.wait_for_function("document.querySelectorAll('[data-note-id]').length===50")
  assert page.get_by_text('別の投稿者によるリポスト元（モック）',exact=True).count()==1
  assert page.get_by_text('全体の投稿 1',exact=True).count()==0
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-following-{width}.png')
  page.evaluate('scrollTo(0,document.body.scrollHeight)')
  page.get_by_text('一部のリレーから取得できませんでした',exact=True).wait_for()
  page.screenshot(path=f'/tmp/nosting-following-{width}-partial.png')
  page.evaluate('window.qa.fail=false')
  page.get_by_text('再試行',exact=True).click()
  page.wait_for_timeout(300)
  page.evaluate('scrollTo(0,document.body.scrollHeight)')
  page.wait_for_function("document.querySelectorAll('[data-note-id]').length>=99")
  page.evaluate('scrollTo(0,document.body.scrollHeight)')
  page.wait_for_function("document.querySelectorAll('[data-note-id]').length===126")
  assert page.locator('[data-note-id]').evaluate_all('(els)=>new Set(els.map(e=>e.dataset.noteId)).size')==126
  page.evaluate('scrollTo(0,0)')
  page.locator('.tabs m3e-button').nth(0).click()
  page.wait_for_function("window.qa.sockets.filter(s=>s.url==='wss://following.example/').every(s=>s.readyState===3)")
  assert page.get_by_text('フォロー相手の古い投稿 1',exact=False).count()==0
  # Change tabs with a delayed response, then remove the follow while loading.
  page.evaluate('window.qa.slow=true')
  page.locator('.tabs m3e-button').nth(1).click()
  page.locator('.tabs m3e-button').nth(0).click()
  page.wait_for_timeout(1100)
  assert page.get_by_text('フォロー相手の古い投稿 1',exact=False).count()==0
  page.locator('.tabs m3e-button').nth(1).click()
  page.evaluate('window.qa.unfollow()')
  page.wait_for_timeout(1200)
  assert page.locator('[data-note-id]').count()==0
  assert page.evaluate("window.qa.sockets.filter(s=>s.url==='wss://following.example/').every(s=>s.readyState===3)")
  # Log out and log in as a different mock account while requests are delayed.
  page.evaluate('window.qa.slow=true;window.qa.follow()')
  page.wait_for_timeout(100)
  if width<650: page.locator('.mobile-header-settings').click()
  else: page.locator('.header-account-button').click()
  page.get_by_text('ログアウト',exact=True).click()
  page.evaluate('window.qa.loginKey=window.qa.otherOwner;window.qa.slow=false')
  page.get_by_text('署名拡張機能に接続',exact=True).click()
  page.wait_for_timeout(300)
  page.locator('.tabs m3e-button').nth(1).click()
  page.wait_for_timeout(1200)
  assert page.locator('[data-note-id]').count()==0
  assert page.evaluate("window.qa.sockets.filter(s=>s.url==='wss://following.example/').every(s=>s.readyState===3)")
  page.evaluate('window.qa.unmount()')
  assert page.evaluate('window.qa.sockets.every(s=>s.readyState===3)')
  assert page.evaluate("window.qa.requests.every(r=>r.frame[0]==='REQ'||r.frame[0]==='CLOSE')")
  assert not errors,errors
  results.append({'width':width,'initial':50,'final':126,'partial_retry':True,'tab_cleanup':True,'follow_cleanup':True,'unmount_cleanup':True,'account_switch':True,'errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
