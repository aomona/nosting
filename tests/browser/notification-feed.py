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
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
  page.goto('http://127.0.0.1:4174/tests/browser/notification-feed.html')
  page.wait_for_function("document.querySelectorAll('[data-notification-id]').length===49")
  assert page.locator('text=ローカル通知 4 —').count()==0
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-notifications-{width}.png')
  page.evaluate('scrollTo(0,document.body.scrollHeight)')
  page.wait_for_function("document.querySelectorAll('[data-notification-id]').length===98")
  # Loading appends without replacing existing DOM or focused content.
  page.evaluate("document.querySelectorAll('.notification-person')[55].focus()")
  anchor=page.evaluate("""()=>{const e=[...document.querySelectorAll('[data-notification-id]')].find(e=>e.getBoundingClientRect().bottom>0);window.qa.anchor=e;return {id:e.dataset.notificationId,top:e.getBoundingClientRect().top}}""")
  page.evaluate("window.qa.add();document.querySelector('.notification-toolbar m3e-button').click()")
  page.wait_for_function("document.querySelectorAll('[data-notification-id]').length===99")
  assert page.evaluate('window.qa.anchor.isConnected')
  top=page.evaluate('window.qa.anchor.getBoundingClientRect().top')
  assert abs(top-anchor['top'])<1, (top,anchor)
  assert page.evaluate("document.activeElement.classList.contains('notification-person')")
  # Partial failure exposes retry; successful retry resumes its old cursor.
  page.evaluate('window.qa.fail=true;scrollTo(0,document.body.scrollHeight)')
  page.get_by_text('一部のリレーから取得できませんでした。',exact=True).wait_for()
  before=page.locator('[data-notification-id]').count()
  page.evaluate('window.qa.fail=false')
  page.get_by_text('再試行',exact=True).click()
  page.wait_for_function(f"document.querySelectorAll('[data-notification-id]').length>{before}")
  page.evaluate('scrollTo(0,document.body.scrollHeight)')
  page.get_by_text('これ以上の通知はありません',exact=True).wait_for()
  assert page.locator('[data-notification-id]').count()==180
  ids=page.locator('[data-notification-id]').evaluate_all('(els)=>els.map(e=>e.dataset.notificationId)')
  assert len(ids)==len(set(ids))
  page.evaluate('scrollTo(0,document.body.scrollHeight)')
  page.screenshot(path=f'/tmp/nosting-notifications-{width}-end.png')
  # Account change during a pending head request cannot show the old account.
  page.evaluate("window.qa.slow=true;document.querySelector('.notification-toolbar m3e-button').click();window.qa.account()")
  page.wait_for_function("document.querySelectorAll('[data-notification-id]').length===0")
  page.get_by_text('このリレーでは通知が見つかりませんでした。',exact=True).wait_for()
  page.evaluate('window.qa.unmount()')
  page.wait_for_function('window.qa.sockets.every(s=>s.readyState===3)')
  assert page.evaluate("window.qa.requests.every(f=>f[0]==='REQ'||f[0]==='CLOSE')")
  assert not errors, errors
  results.append({'viewport':width,'initial':49,'after_scroll':98,'final':180,'anchor_delta':round(top-anchor['top'],3),'unique':True,'retry':True,'account_cleanup':True,'unmount_cleanup':True,'console_errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
