"""Start node tests/browser/reactions-server.mjs, then run this script.
Local fake sockets/signatures only; HTTP outside the harness is blocked.
Screenshots go to /tmp and are never committed.
"""
from playwright.sync_api import sync_playwright
import shutil,json
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 results=[]
 for width in [1280,390,320]:
  page=browser.new_page(viewport={'width':width,'height':900},reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4175/') else route.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text y="26" font-size="28">⭐</text></svg>') if route.request.url=='https://example.invalid/party.png' else route.abort())
  page.goto('http://127.0.0.1:4175/tests/browser/reactions.html')
  page.get_by_label('いいねを取り消す',exact=True).wait_for()
  page.get_by_label('いいねを取り消す',exact=True).click()
  page.wait_for_function('qa.sent.length===1 && qa.sent[0].kind===5')
  page.get_by_label('いいね',exact=True).wait_for()
  assert page.locator('.note-row .actions').evaluate('(e)=>{const r=e.getBoundingClientRect();return [...e.children].filter(x=>x.tagName!=="M3E-DIALOG").every(x=>x.getBoundingClientRect().right<=r.right+1)}')
  page.get_by_label('リアクション',exact=True).click()
  page.get_by_label('🎉 を送信',exact=True).click()
  page.get_by_label('🎉 を取り消す',exact=True).wait_for()
  page.get_by_label('絵文字',exact=True).fill('👨‍👩‍👧‍👦')
  page.locator('form').first.locator('m3e-button').click()
  page.get_by_label('👨‍👩‍👧‍👦 を取り消す',exact=True).wait_for()
  page.locator('summary').click()
  page.get_by_label('名前',exact=True).fill('party')
  page.get_by_label('画像URL',exact=True).fill('https://example.invalid/party.png')
  page.locator('details form m3e-button').click()
  page.get_by_label(':party: を取り消す',exact=True).wait_for()
  page.wait_for_function('qa.sent.some(e=>e.tags.some(t=>t[0]==="emoji"))')
  page.evaluate('qa.external()')
  page.get_by_label('👀 を取り消す',exact=True).wait_for()
  if width<600:
   page.get_by_label('絵文字',exact=True).fill('')
   page.locator('summary').click()
  page.evaluate("document.activeElement?.blur()")
  assert page.locator('.reaction-panel').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
  page.locator('.reaction-own').scroll_into_view_if_needed()
  page.screenshot(path=f'/tmp/nosting-issue22-{width}.png')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.evaluate('qa.refuse=true')
  page.get_by_label('😂 を送信',exact=True).click()
  page.get_by_role('alert').filter(has_text='署名をキャンセル').wait_for()
  before=page.evaluate('qa.sent.length')
  page.evaluate('qa.refuse=false;qa.delay=true')
  page.get_by_label('😂 を送信',exact=True).click()
  page.wait_for_function('qa.signing')
  page.locator('m3e-button').filter(has_text='中止').click()
  page.evaluate('qa.resolve()')
  page.wait_for_function('!qa.signing')
  assert page.evaluate('qa.sent.length')==before
  page.get_by_label('閉じる',exact=True).click()
  page.locator('#account-switch').click()
  page.get_by_label('いいね',exact=True).wait_for()
  page.wait_for_function("document.querySelector('m3e-icon-button[aria-label=\"リアクション\"]').getAttribute('aria-pressed')!=='true'")
  assert not errors,errors
  results.append({'width':width,'restore':True,'remove':True,'unicode':True,'custom':True,'live':True,'refusal':True,'cancel':True,'switch':True,'errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
