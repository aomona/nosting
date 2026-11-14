"""Actual app with mock signer/relays; validate mobile compose geometry, not just screenshots."""
from playwright.sync_api import sync_playwright
import json, shutil
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for w,h in [(1280,1000),(390,844),(375,667),(390,480)]:
  page=b.new_page(viewport={'width':w,'height':h},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:4175') else r.abort())
  page.goto('http://127.0.0.1:4175/tests/browser/direct-messages.html?full=1')
  page.locator('m3e-button').filter(has_text='DMを読み込む').click()
  page.get_by_role('status').filter(has_text='読み込みました').wait_for()
  page.locator('m3e-button').filter(has_text='受信要求').click()
  page.locator('.dm-request m3e-button').filter(has_text='許可').click()
  field=page.locator('#dm-text')
  field.fill('14時で大丈夫です。楽しみにしています！')
  if w<=650:
   page.wait_for_function("""()=>{
    const nav=document.querySelector('.mobile-nav').getBoundingClientRect();
    const pane=document.querySelector('.petal-dm').getBoundingClientRect();
    const input=document.querySelector('#dm-text').getBoundingClientRect();
    const send=document.querySelector('.dm-compose m3e-button').getBoundingClientRect();
    return pane.bottom<=nav.top+1 && input.top>=pane.top && input.bottom<=send.top && send.bottom<=nav.top-12;
   }""")
   # A larger safe-area/navigation bar must reduce the scrollport, rather than cover it.
   page.locator('.mobile-nav').evaluate("el=>el.style.paddingBottom='34px'")
   page.wait_for_function("document.querySelector('.petal-dm').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top+1")
   field.focus()
   page.wait_for_function("document.querySelector('.dm-compose m3e-button').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top-12")
   page.locator('.mobile-nav').evaluate("el=>el.style.removeProperty('padding-bottom')")
  if w==390 and h==844:
   page.set_viewport_size({'width':390,'height':480})
   page.wait_for_function("document.querySelector('.dm-compose m3e-button').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top-12")
   page.set_viewport_size({'width':w,'height':h})
  # Click the real enabled control after checking it is unobscured.
  page.locator('.dm-compose m3e-button').filter(has_text='暗号化して送信').click()
  page.get_by_role('status').filter(has_text='相手 1/1・自分 1/1').wait_for()
  field.focus()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if w<=650:
   page.wait_for_function("document.querySelector('.dm-compose m3e-button').getBoundingClientRect().bottom<=document.querySelector('.mobile-nav').getBoundingClientRect().top-12")
   assert page.evaluate("document.querySelector('.petal-dm').scrollHeight>document.querySelector('.petal-dm').clientHeight")
  if w<=650:
   page.locator('.petal-dm').evaluate('el=>el.scrollTop=el.scrollHeight')
   assert page.evaluate("document.querySelector('#dm-text').getBoundingClientRect().top>=document.querySelector('.petal-dm').getBoundingClientRect().top")
  path=f'/tmp/nosting-issue26-{w}x{h}-app.png'
  page.screenshot(path=path,full_page=True)
  assert not errors,errors
  results.append({'width':w,'height':h,'send':True,'no_navigation_overlap':True,'no_overflow':True,'screenshot':path})
  page.close()
 b.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
