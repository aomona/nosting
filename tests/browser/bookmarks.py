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
  page.goto('http://127.0.0.1:4175/tests/browser/bookmarks.html#/saved')
  page.get_by_text('見つかりません',exact=True).wait_for()
  page.get_by_text('削除済み',exact=True).wait_for()
  assert page.locator('article[data-note-id]').count()==1
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-bookmarks-{width}-guest.png')
  # Guest reload explicitly re-fetches IDs absent from the timeline.
  page.reload()
  page.get_by_text('削除済み',exact=True).wait_for()
  assert page.locator('article[data-note-id]').count()==1
  assert page.evaluate("window.qa.requests.some(f=>f[0]==='REQ'&&f.slice(2).some(q=>q.ids?.includes(window.qa.noteId)))")
  page.get_by_role('button',name='ログイン',exact=True).click()
  page.get_by_text('別クライアントで保存した投稿。',exact=True).wait_for()
  page.get_by_text('非公開は未対応',exact=False).wait_for()
  assert page.locator('article[data-note-id]').count()==1
  assert page.get_by_text('削除済み',exact=True).count()==0
  assert page.evaluate("JSON.parse(localStorage.getItem('petal-bookmarks:v2:'+qa.owner)).local.length===0")
  # A failed relay does not hide a valid note or claim the list is empty.
  page.evaluate('qa.fail=true')
  page.get_by_role('button',name='再取得',exact=True).click()
  page.get_by_text('一部リレー取得失敗',exact=False).wait_for()
  page.wait_for_function("!document.querySelector('.bookmark-toolbar m3e-icon-button').disabled")
  assert page.locator('article[data-note-id]').count()==1
  assert page.locator('.bookmark-toolbar').bounding_box()['height']<=48
  if width==390:
   for narrow in [320,360,390]:
    page.set_viewport_size({'width':narrow,'height':height})
    page.wait_for_timeout(100)
    assert page.evaluate("""()=>{const labels=[...document.querySelectorAll('.mobile-nav m3e-nav-item')].map(e=>e.shadowRoot.querySelector('.label').getBoundingClientRect());return labels.every((r,i)=>r.left>=0&&r.right<=innerWidth&&(!i||r.left>=labels[i-1].right))}"""), narrow
   assert page.locator('.mobile-nav m3e-nav-item[aria-label=プロフィール]').is_visible()
  page.screenshot(path=f'/tmp/nosting-bookmarks-{width}-partial.png')
  page.evaluate('qa.fail=false;qa.update()')
  page.get_by_role('button',name='再取得',exact=True).click()
  page.get_by_text('以前に保存した投稿。タイムラインになくても、IDから読み込めます。',exact=True).wait_for()
  page.wait_for_function("!document.querySelector('.bookmark-toolbar m3e-icon-button').disabled")
  assert page.get_by_text('別クライアントで保存した投稿。',exact=True).count()==0
  # Local removal of a synced item never signs or changes the signed list.
  page.locator('article m3e-icon-button[aria-label="ブックマーク"]').click()
  page.get_by_text('ブックマークはまだありません',exact=True).wait_for()
  assert page.evaluate("JSON.parse(localStorage.getItem('petal-bookmarks:v2:'+qa.owner)).event.tags.some(t=>t[1]===qa.noteId)")
  # Logout while reading, then log in with another ephemeral test account.
  page.evaluate("qa.slow=true;document.querySelector('.bookmark-toolbar m3e-icon-button').click()")
  if width<=650: page.locator('.mobile-header-settings[aria-label="設定"]').click()
  else: page.get_by_text('アカウント',exact=True).click()
  page.get_by_text('ログアウト',exact=True).click()
  page.keyboard.press('Escape')
  page.evaluate('qa.slow=false;qa.account=qa.otherOwner')
  page.get_by_role('button',name='ログイン',exact=True).click()
  page.get_by_text('ブックマークはまだありません',exact=True).wait_for()
  page.wait_for_timeout(1700)
  assert page.locator('article[data-note-id]').count()==0
  assert page.evaluate("localStorage.getItem('petal-bookmarks')===JSON.stringify(qa.guestIds)")
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.evaluate("qa.requests.every(f=>f[0]==='REQ'||f[0]==='CLOSE')")
  page.evaluate('qa.unmount()')
  page.wait_for_function('qa.sockets.every(s=>s.readyState===3)')
  assert not errors, errors
  results.append({'width':width,'reload':True,'account_isolation':True,'external_update':True,'partial_retry':True,'local_removal':True,'late_response_cancelled':True,'unmount_cleanup':True,'errors':errors})
  page.close()
 # Account mute integration must also filter notes fetched only by the bookmark session.
 page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
 page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4175') else route.abort())
 page.goto('http://127.0.0.1:4175/tests/browser/bookmarks.html?muted=1#/saved')
 page.get_by_text('削除済み',exact=True).wait_for()
 page.get_by_role('button',name='ログイン',exact=True).click()
 page.wait_for_function("JSON.parse(localStorage.getItem('petal-bookmarks:v2:'+qa.owner)||'null')?.event && !document.querySelector('.bookmark-toolbar m3e-icon-button').disabled")
 assert page.evaluate("qa.requests.some(f=>f[0]==='REQ'&&f.slice(2).some(q=>q.kinds?.includes(10000)))")
 assert page.evaluate("qa.requests.some(f=>f[0]==='REQ'&&f.slice(2).some(q=>q.ids?.includes(qa.remoteId)))")
 assert page.locator('article[data-note-id]').count()==0
 assert page.evaluate("JSON.parse(localStorage.getItem('petal-bookmarks:v2:'+qa.owner)).event.tags.some(t=>t[1]===qa.remoteId)")
 # Keep main's isolated direct-message route, without loading or publishing DMs here.
 page.evaluate("location.hash='#/messages'")
 page.get_by_role('button',name='DMを読み込む',exact=True).wait_for()
 assert page.evaluate("qa.requests.every(f=>f[0]==='REQ'||f[0]==='CLOSE')")
 page.close()
 results.append({'account_mutes_apply_to_saved_notes':True,'dm_route_preserved':True})
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
