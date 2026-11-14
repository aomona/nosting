"""Full app mock QA; serve relay-auth.html with Vite and the @ alias set to repo root.
No native WebSocket or user keys; external HTTP is blocked. Images stay in /tmp.
"""
from playwright.sync_api import sync_playwright
import json
import shutil
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for width,height in [(1280,900),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
  page.route_web_socket('**/*',lambda ws:ws.connect_to_server() if ws.url.startswith('ws://127.0.0.1:4174') else ws.close())
  page.goto('http://127.0.0.1:4174/tests/browser/relay-auth.html')
  page.get_by_text('ログイン',exact=True).click()
  page.wait_for_function("qa.sent.some(([url,m])=>url==='wss://auth.example/' && m[0]==='REQ')")
  page.get_by_role('button',name='リレー接続状態:',exact=False).click()
  panel=page.get_by_role('region',name='リレー認証')
  panel.get_by_text('認証が必要',exact=True).wait_for()
  assert page.evaluate('qa.signed.length===0')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-issue19-{width}-before.png')
  panel.get_by_role('button',name='wss://auth.example/に認証').click()
  panel.get_by_text('認証済み',exact=True).wait_for()
  assert page.evaluate("qa.signed.length===1 && qa.sent.filter(([,m])=>m[0]==='AUTH').length===1 && !qa.sent.some(([,m])=>m[0]==='EVENT')")
  assert page.evaluate("qa.sent.filter(([u,m])=>u==='wss://auth.example/'&&m[0]==='REQ'&&m[1]==='feed').length===2")
  page.screenshot(path=f'/tmp/nosting-issue19-{width}-authenticated.png')
  # A fresh application run verifies dialog-close cancellation during a pending signature.
  page.reload()
  page.get_by_text('ログイン',exact=True).click()
  page.wait_for_function("qa.sent.some(([url,m])=>url==='wss://auth.example/' && m[0]==='REQ')")
  page.get_by_role('button',name='リレー接続状態:',exact=False).click()
  panel.get_by_text('認証が必要',exact=True).wait_for()
  page.evaluate('qa.hold=true')
  panel.get_by_role('button',name='wss://auth.example/に認証').click()
  panel.get_by_text('署名を確認中…',exact=True).wait_for()
  page.keyboard.press('Escape')
  page.wait_for_function("!document.querySelector('m3e-dialog[aria-label=\"設定と接続\"]').open")
  page.evaluate('qa.release()')
  page.wait_for_timeout(100)
  assert page.evaluate("!qa.sent.some(([,m])=>m[0]==='AUTH'||m[0]==='EVENT')")
  assert not errors,errors
  results.append({'width':width,'explicit_auth':True,'replayed_feed':True,'dialog_close_cancels':True,'external_network':'blocked','pageerrors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
