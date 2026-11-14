"""Actual app, mocked relay/signer. Themes, keyboard, touch targets and compact viewport geometry."""
from playwright.sync_api import sync_playwright
import json, re, shutil
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for w,h,theme in [(1280,1000,'light'),(1280,1000,'dark'),(390,844,'light'),(390,844,'dark'),(375,667,'light'),(390,480,'light'),(390,480,'dark')]:
  page=b.new_page(viewport={'width':w,'height':h},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4175') else r.abort())
  page.goto(f'http://127.0.0.1:4175/tests/browser/direct-messages.html?full=1&theme={theme}')
  page.wait_for_function('(theme)=>document.documentElement.dataset.theme===theme',arg=theme)
  load=page.get_by_role('button',name='DMを読み込む',exact=True)
  load.focus();load.press('Enter')
  page.get_by_role('status').filter(has_text='読み込みました').wait_for(state='attached')
  requests=page.get_by_role('button',name=re.compile('^受信要求'))
  requests.focus();requests.press('Enter')
  assert 'こんにちは' not in page.locator('body').inner_text()
  allow=page.locator('.dm-request').get_by_role('button',name='許可',exact=True)
  allow.focus();allow.press('Enter')
  field=page.locator('#dm-text')
  page.wait_for_function("document.activeElement?.id==='dm-text'")
  assert page.locator('#dm-peer').count()==0
  settings=page.get_by_role('button',name='DM設定',exact=True)
  settings.focus()
  page.wait_for_function("[...document.querySelectorAll('m3e-tooltip')].some(t=>t.textContent==='DM設定'&&t.isOpen)")
  settings.press('Enter')
  page.get_by_text('接続先にアカウントを認証（NIP-42）',exact=True).wait_for()
  page.get_by_text('受信リレーの設定は公開されます。',exact=True).wait_for()
  publish=page.get_by_role('button',name='受信設定を公開',exact=True)
  assert publish.is_visible()
  publish.click()
  page.locator('.dm-status p').filter(has_text='受信設定を 1/1 リレーで公開しました').wait_for()
  assert page.evaluate("qa.sent.some(e=>e.eventKind===10050)")
  page.wait_for_function("document.activeElement!==document.body&&document.querySelector('.petal-dm').contains(document.activeElement)")
  page.keyboard.press('Escape')
  page.wait_for_function("document.activeElement?.getAttribute('aria-label')==='DM設定'")
  new=page.get_by_role('button',name='新規会話',exact=True)
  new.focus();new.press('Enter')
  page.wait_for_function("document.activeElement?.id==='dm-peer'")
  page.locator('#dm-peer').fill(page.evaluate('qa.peer'))
  page.locator('#dm-peer').press('Enter')
  page.wait_for_function("document.activeElement?.id==='dm-text'")
  field.fill('14時で大丈夫です。楽しみにしています！')
  send=page.get_by_role('button',name='暗号化して送信',exact=True)
  if w<=650:
   page.wait_for_function("""()=>{
    const nav=document.querySelector('.mobile-nav').getBoundingClientRect();
    const pane=document.querySelector('.petal-dm').getBoundingClientRect();
    const input=document.querySelector('#dm-text').getBoundingClientRect();
    const send=document.querySelector('[aria-label="暗号化して送信"]').getBoundingClientRect();
    const toolbar=document.querySelector('.dm-navigation').getBoundingClientRect();
    return pane.bottom<=nav.top+1 && input.top>=toolbar.bottom && input.right<=send.left && send.bottom<=nav.top-12;
   }""")
   page.locator('.mobile-nav').evaluate("el=>el.style.paddingBottom='34px'")
   page.wait_for_function("document.querySelector('.petal-dm').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top+1")
   field.focus()
   page.wait_for_function("document.querySelector('[aria-label=\"暗号化して送信\"]').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top-12")
   page.locator('.mobile-nav').evaluate("el=>el.style.removeProperty('padding-bottom')")
  if w==390 and h==844:
   page.set_viewport_size({'width':390,'height':480})
   page.wait_for_function("document.querySelector('[aria-label=\"暗号化して送信\"]').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top-12")
   page.set_viewport_size({'width':w,'height':h})
  before=page.evaluate("qa.sent.filter(e=>e.eventKind===1059).length")
  field.dispatch_event('keydown',{'key':'Enter','ctrlKey':True,'isComposing':True})
  assert page.evaluate("qa.sent.filter(e=>e.eventKind===1059).length")==before
  # A real keyboard shortcut sends once; ordinary Enter stays available for a newline.
  field.press('Control+Enter')
  page.get_by_role('status').filter(has_text='送信を確認しました').wait_for(state='attached')
  assert page.locator('.dm-status p').count()==0
  assert page.locator('.dm-message').count()==2
  page.get_by_role('button',name='操作結果の詳細',exact=True).click()
  page.locator('.dm-status p').filter(has_text='相手 1/1・自分 1/1').wait_for()
  page.get_by_role('button',name='操作結果の詳細',exact=True).click()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.locator('.dm-tools m3e-icon-button').evaluate_all('els=>els.every(e=>e.getBoundingClientRect().width>=44&&e.getBoundingClientRect().height>=44)')
  # Leave an unsent mock draft to show the primary action; do not dispatch it.
  field.fill('では、また明日！')
  field.blur()
  page.mouse.move(0,0)
  page.wait_for_function("[...document.querySelectorAll('m3e-tooltip')].every(t=>!t.isOpen)")
  path=f'/tmp/nosting-issue26-compact-{w}x{h}-{theme}.png'
  page.screenshot(path=path,full_page=True)
  if w==390 and h==480:
   page.evaluate('qa.rejectRecipient=true')
   page.get_by_role('button',name='暗号化して送信',exact=True).click()
   page.locator('.dm-status p').filter(has_text='相手 0/1・自分 1/1').wait_for()
   retry=page.get_by_role('button',name='同じDMを再送',exact=True)
   page.wait_for_function("[...document.querySelectorAll('.dm-compose m3e-button')].some(e=>e.getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top-12)")
   page.evaluate('qa.rejectRecipient=false')
   retry.focus();retry.press('Enter')
   page.get_by_role('status').filter(has_text='送信を確認しました').wait_for(state='attached')
  assert not errors,errors
  results.append({'width':w,'height':h,'theme':theme,'keyboard_and_ime':True,'tooltip_and_focus':True,'navigation_clear':True,'touch_targets':True,'screenshot':path})
  page.close()
 b.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
