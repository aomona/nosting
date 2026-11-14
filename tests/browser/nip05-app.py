"""Actual app layout with in-memory relay/lookup mocks. Run the browser server first."""
from playwright.sync_api import sync_playwright
import os
import shutil
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 for width,height in [(1280,900),(390,844),(320,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce',has_touch=width<650)
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
  page.goto('http://127.0.0.1:4174/tests/browser/nip05-app.html')
  status=page.get_by_role('button',name='NIP-05: haru@example.com、公開鍵と一致',exact=True)
  status.wait_for()
  assert page.locator('.petal-profile-handle').bounding_box()['height']<=24
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-nip05-app-profile-{width}.png',full_page=True)
  if width<650: status.tap()
  else:
   status.focus()
   page.keyboard.press('Enter')
  page.get_by_role('dialog').wait_for()
  assert '本人の信頼性を保証するものではありません' in page.get_by_role('dialog').aria_snapshot()
  page.get_by_role('button',name='閉じる',exact=True).click()
  page.get_by_role('dialog').wait_for(state='hidden')
  page.get_by_role('link' if width>650 else 'button',name='みつける',exact=True).click()
  page.get_by_role('textbox',name='検索語').fill('haru@example.com')
  page.get_by_role('textbox',name='検索語').press('Enter')
  result=page.get_by_role('region',name='NIP-05 検索結果')
  result.get_by_role('button',name='Haru haru@example.com',exact=True).wait_for()
  assert page.locator('.nip05-search-row').bounding_box()['height']<=40
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.mouse.move(0,0)
  page.screenshot(path=f'/tmp/nosting-nip05-app-search-{width}.png',full_page=True)
  result.get_by_role('button',name='Haru haru@example.com',exact=True).click()
  assert page.evaluate("location.hash==='#/profile/'+window.qa.pubkey")
  page.get_by_role('button',name='ログイン',exact=True).click()
  page.get_by_role('button',name='編集',exact=True).click()
  toggle=page.get_by_role('button',name='NIP-05',exact=True)
  toggle.wait_for()
  assert toggle.get_attribute('aria-expanded')=='false'
  toggle.scroll_into_view_if_needed()
  page.screenshot(path=f'/tmp/nosting-nip05-app-editor-{width}.png',full_page=True)
  toggle.click()
  field=page.get_by_role('textbox',name='NIP-05',exact=True)
  field.wait_for()
  assert field.input_value()=='haru@example.com'
  field.scroll_into_view_if_needed()
  page.screenshot(path=f'/tmp/nosting-nip05-app-editor-expanded-{width}.png',full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.evaluate("window.qa.frames.every(f=>['REQ','CLOSE'].includes(f[0]))")
  assert not errors,errors
  print(f'PASS actual app {width}px: compact profile/search, tooltip keyboard/touch, pubkey route, edit disclosure, no overflow/errors or publication',flush=True)
  page.close()
 browser.close()
