from playwright.sync_api import sync_playwright
import os,shutil,json
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for width,height in [(1280,1000),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
  page.goto('http://127.0.0.1:4174/tests/browser/account-mutes.html')
  page.wait_for_function('window.qa?.ready && window.qa.filtered')
  assert page.get_by_label('保存先',exact=True).input_value()=='private'
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-account-mutes-{width}.png',full_page=True)
  page.locator('#mute-word').fill('ブラウザーのみ')
  page.locator('form').filter(has=page.locator('#mute-word')).get_by_role('button',name='追加',exact=True).click()
  page.wait_for_function("window.qa.local.words.includes('ブラウザーのみ')")
  page.get_by_label('種類',exact=True).select_option('word')
  page.locator('#account-mute-value').fill('追加のテスト')
  page.get_by_text('署名して追加',exact=True).click()
  page.get_by_text('1/2 リレーで保存を確認（残りは未確認）',exact=True).wait_for()
  assert page.evaluate('window.qa.sent.length')==1
  assert page.evaluate("window.qa.local.words.includes('ブラウザーのみ')")
  page.get_by_text('再読み込み',exact=True).click()
  page.wait_for_function('window.qa.ready')
  page.get_by_text('ワード: 追加のテスト',exact=True).wait_for()
  # Partial relay failure keeps verified filter state, but prevents replacement.
  page.evaluate('window.qa.fail=true;window.qa.reload()')
  page.get_by_role('alert').filter(has_text='未応答').wait_for()
  assert page.evaluate('window.qa.filtered && !window.qa.ready')
  page.evaluate('window.qa.fail=false;window.qa.reload()')
  page.wait_for_function('window.qa.ready')
  # Close while signer is pending: no publication after signer resolves.
  page.wait_for_timeout(1100)
  page.evaluate('window.qa.signWait=true')
  page.locator('#account-mute-value').fill('キャンセル')
  page.get_by_text('署名して追加',exact=True).click()
  page.wait_for_function('typeof window.qa.releaseSign==="function"')
  page.evaluate('window.qa.close()')
  page.wait_for_function('!document.querySelector(".account-mute-settings")')
  page.evaluate('window.qa.account();window.qa.open()')
  page.wait_for_function('window.qa.ready && !window.qa.filtered')
  page.evaluate('window.qa.releaseSign()')
  page.wait_for_timeout(100)
  assert page.evaluate('window.qa.sent.length')==1
  page.wait_for_function('window.qa.ready && !window.qa.filtered')
  assert page.get_by_text('ワード: ネタバレ',exact=True).count()==0
  assert page.evaluate('window.qa.local.words.length')==0
  assert page.evaluate("window.qa.frames.every(f=>['REQ','CLOSE'].includes(f[0]))")
  assert page.evaluate('window.qa.sockets.every(s=>s.readyState===3)')
  assert not errors,errors
  results.append({'width':width,'overflow':False,'private_default':True,'local_preserved':True,'partial_guard':True,'cancel_guard':True,'account_isolation':True,'console_errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
