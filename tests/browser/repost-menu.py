"""Run node tests/browser/server.mjs, then python tests/browser/repost-menu.py.
Real App + M3E with the quote fixture's synthetic identities and mock sockets.
All external HTTP is blocked. Screenshots remain local and are never uploaded.
"""
from playwright.sync_api import sync_playwright, expect
import json
import os
import shutil

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    results=[]
    for width,height in [(1280,900),(390,844),(320,640)]:
        page=browser.new_page(viewport={'width':width,'height':height},has_touch=width<650,is_mobile=width<650,reduced_motion='no-preference' if width==1280 else 'reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
        page.add_init_script("localStorage.setItem('petal-dark','true')")
        page.goto('http://127.0.0.1:4174/tests/browser/quote-post.html')
        source_id=page.evaluate('qa.source.id')
        source=page.locator(f'article[data-note-id="{source_id}"]')
        trigger=source.get_by_role('button',name='リポスト',exact=True)
        menu=source.get_by_role('menu',name='リポストの操作')
        repost=menu.get_by_role('menuitem',name='リポスト',exact=True)
        quote=menu.get_by_role('menuitem',name='引用する',exact=True)
        trigger.wait_for()
        def opened():
            expect(menu).to_be_visible()
            expect(trigger).to_have_attribute('aria-expanded','true')
            expect(menu.get_by_role('menuitem')).to_have_count(2)
            page.wait_for_timeout(150)
        def closed():
            expect(menu).not_to_be_visible()
            expect(trigger).to_have_attribute('aria-expanded','false')
        def contained():
            box=menu.bounding_box()
            assert box and box['x']>=-1 and box['y']>=-1 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,box
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        def choose(item):
            expect(item).to_be_visible()
            expect(item).not_to_have_attribute('aria-disabled','true')
            box=item.bounding_box()
            assert box and box['y']>=0 and box['y']+box['height']<=height
            # Locator.click scrolls native popover descendants into the document
            # in Chromium. Hit-test the visible item as an actual user does.
            x,y=box['x']+box['width']/2,box['y']+box['height']/2
            if width<650: page.touchscreen.tap(x,y)
            else: page.mouse.click(x,y)
        initial_height=source.bounding_box()['height']
        trigger.focus()
        page.keyboard.press('Enter');opened();contained()
        expect(repost).to_be_focused()
        page.keyboard.press('ArrowDown');expect(quote).to_be_focused()
        page.keyboard.press('ArrowDown');expect(repost).to_be_focused()
        page.keyboard.press('End');expect(quote).to_be_focused()
        page.keyboard.press('Home');expect(repost).to_be_focused()
        page.keyboard.press('Escape');closed();expect(trigger).to_be_focused()
        page.keyboard.press('Space');opened()
        page.keyboard.press('Tab');closed()
        trigger.click();opened()
        page.screenshot(path=f'/tmp/nosting-repost-{width}-dark.png')
        page.get_by_role('textbox',name='投稿本文').click();closed()
        expect(page.get_by_role('textbox',name='投稿本文')).to_be_focused()
        assert source.bounding_box()['height']==initial_height
        assert '#/thread/' not in page.url
        # One anchored menu, including fast repeat activation during positioning.
        trigger.evaluate('e=>{for(let i=0;i<8;i++)e.click()}');opened()
        expect(page.get_by_role('menu')).to_have_count(1)
        page.keyboard.press('Escape');closed()
        trigger.focus();page.keyboard.press('ArrowDown');opened()
        page.keyboard.press('Escape');closed()
        # Exercise collision handling at every viewport corner with the real trigger.
        # Reparent only for this geometry probe: note content-visibility contains fixed children.
        trigger.evaluate('e=>{window.qa.triggerParent=e.parentNode;window.qa.triggerNext=e.nextSibling;document.querySelector("m3e-theme").append(e)}')
        trigger=page.locator('m3e-icon-button[aria-label="リポスト"]')
        for top,left in [(4,4),(4,width-44),(height-44,4),(height-44,width-44)]:
            trigger.evaluate('(e,p)=>{e.style.position="fixed";e.style.top=p[0]+"px";e.style.left=p[1]+"px";e.style.zIndex=30}',[top,left])
            trigger.click();opened();contained()
            page.keyboard.press('Escape');closed()
        trigger.evaluate('e=>{e.removeAttribute("style");qa.triggerParent.insertBefore(e,qa.triggerNext)}')
        # Scrolling dismisses the menu instead of leaving it detached from its note.
        page.evaluate('document.body.style.minHeight="1800px"')
        trigger.click();opened()
        page.mouse.wheel(0,160);closed()
        page.wait_for_timeout(400)
        page.evaluate('window.scrollTo(0,0)')
        page.wait_for_timeout(100)
        # Missing extensions use the existing login dialog without a menu behind it.
        page.evaluate('qa.signer=window.nostr;window.nostr=undefined')
        trigger.click();opened();choose(quote);closed()
        expect(page.get_by_text('Nostr署名拡張機能（NIP-07）が見つかりません。対応ブラウザで開いてください。')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('m3e-dialog')).not_to_have_attribute('open','')
        page.evaluate('window.nostr=qa.signer')
        # Guest repost logs in, but does not implicitly sign or publish.
        guest_menu_id=trigger.get_attribute('aria-controls')
        trigger.click();opened();choose(repost)
        page.wait_for_function("document.querySelector('.header-account-button').textContent==='アカウント'")
        assert page.evaluate('qa.signed.length===0 && qa.published.length===0')
        # Account relay replacement may remount the source/menu.
        source.wait_for()
        expect(trigger).not_to_have_attribute('aria-controls',guest_menu_id)
        expect(trigger).to_have_attribute('aria-expanded','false')
        page.wait_for_timeout(300)
        if menu.is_visible():
            page.keyboard.press('Escape');closed()
        # Signing rejection keeps both choices and permits retry.
        page.evaluate("qa.mode='cancel'")
        trigger.click();opened();choose(repost)
        page.wait_for_function('qa.signed.length===1')
        expect(repost).not_to_have_attribute('aria-disabled','true')
        expect(menu).to_be_visible()
        assert page.evaluate('qa.published.length===0')
        # Closing during signing prevents the late signed event from being sent.
        page.evaluate("qa.mode='hold'")
        choose(repost);page.wait_for_function('qa.signed.length===2')
        expect(repost).to_have_attribute('aria-disabled','true')
        page.keyboard.press('Escape');closed();expect(trigger).to_be_focused()
        page.evaluate("qa.mode='success';qa.release()")
        page.wait_for_timeout(100)
        assert page.evaluate('qa.published.length===0')
        trigger.click();opened()
        # While signing is pending, repeated input must not duplicate the event.
        page.evaluate("qa.mode='hold'")
        choose(repost);page.wait_for_function('qa.signed.length===3')
        repost.evaluate('e=>{for(let i=0;i<5;i++)e.click()}')
        page.keyboard.press('Enter')
        assert page.evaluate('qa.signed.length===3 && qa.published.length===0')
        page.evaluate("qa.mode='success';qa.release()")
        page.wait_for_function('qa.published.length===1');closed();expect(trigger).to_be_focused()
        event=page.evaluate('qa.published[0].event')
        assert event['kind']==6 and json.loads(event['content'])['id']==source_id
        # accountConnections reads both NIP-65 entries; either may verify the source.
        assert any(tag[0:2]==['e',source_id] and tag[2] in ['wss://read.example/','wss://write.example/'] for tag in event['tags'])
        assert ['p',page.evaluate('qa.source.pubkey')] in event['tags']
        assert page.evaluate("qa.published[0].url==='wss://write.example/'")
        # Quote opens the existing composer; close returns to the originating button.
        trigger.click();opened();page.keyboard.press('End');page.keyboard.press('Enter')
        text=page.get_by_role('textbox',name='引用の本文')
        expect(text).to_be_visible();closed();expect(text).to_be_focused()
        text.press('Escape');expect(text).not_to_be_visible();expect(trigger).to_be_focused()
        assert '#/thread/' not in page.url
        assert not errors,errors
        results.append({'viewport':width,'keyboard':True,'focus_return':True,'outside_click':True,'corners':True,'scroll':True,'single_send':True,'guest_login':True,'kind6':True,'quote_handoff':True,'errors':errors})
        page.close()
    print(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
