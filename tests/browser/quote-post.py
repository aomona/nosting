"""Run node tests/browser/server.mjs, then python tests/browser/quote-post.py.
Real app, generated local identities, mocked WebSockets; external HTTP blocked.
Screenshots stay in /tmp. No extension, public relay, or public post is used.
"""
from playwright.sync_api import sync_playwright, expect
import json
import os
import shutil

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    results=[]
    for width,height in [(1280,900),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
        page.goto('http://127.0.0.1:4174/tests/browser/quote-post.html')
        source_id=page.evaluate('qa.source.id')
        source=page.locator(f'article[data-note-id="{source_id}"]')
        source.wait_for()
        def open_quote():
            source.locator('m3e-icon-button[aria-label="リポスト"]').click()
            page.get_by_role('menuitem',name='引用する').click()
            page.get_by_role('textbox',name='引用の本文').wait_for()
        # Dismissing while login is pending must not reopen a composer later.
        page.evaluate('qa.loginHold=true')
        source.locator('m3e-icon-button[aria-label="リポスト"]').click()
        page.get_by_role('menuitem',name='引用する').click()
        page.wait_for_function('typeof qa.loginRelease===\'function\'')
        page.keyboard.press('Escape')
        page.evaluate('qa.loginRelease()')
        expect(page.get_by_role('textbox',name='引用の本文')).not_to_be_visible()
        source.wait_for()
        open_quote()
        text=page.get_by_role('textbox',name='引用の本文')
        form=page.locator('.quote-composer')
        send=form.locator('m3e-button').filter(has_text='署名して引用')
        expect(form).to_contain_text('小さな発見を、みんなで。')
        assert page.evaluate('qa.signed.length===0 && qa.published.length===0')
        text.fill('この視点が好きです。')
        # Cancel, reopen, and keep the draft separate from home and inline replies.
        text.press('Escape')
        expect(text).not_to_be_visible()
        source.wait_for()
        open_quote()
        expect(text).to_have_value('この視点が好きです。')
        assert page.get_by_role('textbox',name='投稿本文').input_value()==''
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        text.focus()
        assert text.evaluate("element=>getComputedStyle(element).outlineStyle!=='none'")
        page.screenshot(path=f'/tmp/nosting-quote-{width}.png')
        # IME composition and auto-repeated shortcuts cannot initiate signing.
        text.evaluate("element=>{element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,repeat:true,bubbles:true}))}")
        assert page.evaluate('qa.signed.length===0')
        page.evaluate("qa.mode='cancel'")
        send.click()
        expect(form.get_by_role('alert')).to_be_visible()
        expect(text).to_have_value('この視点が好きです。')
        assert page.evaluate('qa.signed.length===1 && qa.published.length===0')
        page.evaluate("qa.mode='reject'")
        text.press('Control+Enter')
        page.wait_for_function('qa.published.length===1')
        expect(form.get_by_role('alert')).to_be_visible()
        expect(text).to_have_value('この視点が好きです。')
        # In-flight repeated clicks and keyboard activation sign only once.
        text.fill('この視点が好きです。追記。')
        page.evaluate("qa.mode='hold'")
        send.click()
        page.wait_for_function('qa.signed.length===3')
        text.press('Control+Enter')
        text.press('Escape')
        expect(text).to_be_visible()
        assert page.evaluate('qa.signed.length===3 && qa.published.length===1')
        page.evaluate("qa.mode='timeout';qa.release()")
        page.wait_for_function('qa.published.length===2')
        expect(form.get_by_role('alert')).to_be_visible(timeout=12000)
        expect(text).to_have_value('この視点が好きです。追記。')
        page.evaluate("qa.mode='success'")
        send.click()
        expect(text).not_to_be_visible()
        page.wait_for_function('qa.published.length===3')
        assert page.evaluate('qa.signed.length===3 && qa.published[1].event.id===qa.published[2].event.id')
        assert page.evaluate("qa.published.every(item=>item.url==='wss://write.example/')")
        event=page.evaluate('qa.published.at(-1).event')
        assert event['kind']==1 and not any(tag[0]=='e' for tag in event['tags'])
        assert ['q',source_id,'',page.evaluate('qa.source.pubkey')] in event['tags']
        posted=page.locator(f'article[data-note-id="{event["id"]}"]')
        expect(posted).to_contain_text('この視点が好きです。')
        expect(posted.locator('.petal-quote')).to_contain_text('小さな発見を、みんなで。')
        open_quote()
        expect(text).to_have_value('')
        text.press('Escape')
        expect(text).not_to_be_visible()
        # A threaded reply still uses e tags, independently of quote drafts.
        source.locator('m3e-icon-button[aria-label="返信"]').click()
        reply=source.locator('.inline-reply-input')
        expect(reply).to_have_value('')
        reply.fill('返信のテスト')
        reply.press('Control+Enter')
        page.wait_for_function('qa.published.length===4')
        assert page.evaluate("qa.published.at(-1).event.tags.some(tag=>tag[0]==='e'&&tag[1]===qa.source.id)")
        assert not errors,errors
        results.append({'viewport':width,'draft_reopen':True,'signer_cancel':True,'relay_rejection':True,'single_send':True,'outbox_only':True,'timeout_retry_same_id':True,'render_roundtrip':True,'reply_distinct':True,'errors':errors})
        page.close()
    print(json.dumps(results,ensure_ascii=False,indent=2))
    browser.close()
