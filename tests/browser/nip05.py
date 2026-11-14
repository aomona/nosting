"""Run node tests/browser/server.mjs, then python tests/browser/nip05.py.
All lookup/relay/signing behavior is local mock data; screenshots stay in /tmp.
"""
from playwright.sync_api import sync_playwright
import os
import shutil
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 for width,height in [(1280,900),(390,844),(320,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
  page.goto('http://127.0.0.1:4174/tests/browser/nip05.html')
  page.get_by_text('公開鍵と一致',exact=True).first.wait_for()
  page.get_by_text('haru@example.com を検索',exact=True).click()
  result=page.get_by_role('region',name='NIP-05 検索結果')
  result.get_by_text('公開鍵と一致',exact=True).wait_for()
  result.get_by_text('一部のリレーは未確認です',exact=True).wait_for()
  result.get_by_text('Haru',exact=True).click()
  assert page.evaluate("/^[a-f0-9]{64}$/.test(window.qa.opened)")
  assert page.evaluate("window.qa.frames.every(f=>['REQ','CLOSE'].includes(f[0]))")
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-nip05-profile-{width}.png',full_page=True)
  page.get_by_text('検証用の未確認状態',exact=True).click()
  page.get_by_text('キャンセル検証',exact=True).click()
  page.wait_for_timeout(300)
  assert page.locator('details').get_by_text('未確認',exact=True).count()==3
  page.get_by_text('編集',exact=True).click()
  field=page.get_by_role('textbox',name='NIP-05',exact=True)
  field.wait_for()
  assert field.input_value()=='haru@example.com'
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-nip05-editor-{width}.png',full_page=True)
  field.fill('new@example.com')
  page.get_by_text('署名して保存',exact=True).click()
  page.get_by_text('new@example.com',exact=True).wait_for()
  assert page.evaluate("window.qa.saved.nip05==='new@example.com' && window.qa.saved.custom.keep")
  assert not errors,errors
  print(f'PASS {width}px: matched/unknown, partial relay, pubkey navigation, edit preserving unknown metadata, no overflow or runtime errors')
  page.close()
 browser.close()
