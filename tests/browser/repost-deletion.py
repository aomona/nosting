"""Merged repost menu + NIP-09 UI, using generated identities and mock relays only."""
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
        page.goto('http://127.0.0.1:4174/tests/browser/quote-post.html?deletions=1')
        ids=page.evaluate('({source:qa.source.id,note:qa.ownNote.id,repost:qa.ownRepost.id})')
        source=page.locator(f'article[data-note-id="{ids["source"]}"]')
        own=page.locator(f'article[data-note-id="{ids["note"]}"]')
        repost=page.locator(f'article[data-note-id="{ids["repost"]}"]')
        repost.wait_for()
        expect(page.get_by_role('button',name='投稿の操作',exact=True)).to_have_count(0)
        page.get_by_role('button',name='ログイン',exact=True).click()
        page.wait_for_function("document.querySelector('.header-account-button').textContent==='アカウント'")
        menu=repost.get_by_role('button',name='投稿の操作',exact=True)
        expect(menu).to_be_visible()
        expect(source.get_by_role('button',name='投稿の操作',exact=True)).to_have_count(0)
        expect(own.get_by_role('button',name='投稿の操作',exact=True)).to_be_visible()
        # The compact menu and the owned repost's deletion menu coexist.
        trigger=repost.get_by_role('button',name='リポスト',exact=True)
        trigger.focus();trigger.press('Enter')
        compact=repost.get_by_role('menu',name='リポストの操作')
        expect(compact).to_be_visible()
        expect(compact.get_by_role('menuitem')).to_have_count(2)
        expect(compact.get_by_role('menuitem',name='リポスト',exact=True)).to_be_focused()
        page.wait_for_timeout(150)
        page.keyboard.press('Escape');expect(compact).not_to_be_visible();expect(trigger).to_be_focused()
        page.wait_for_timeout(200)
        dialog=page.locator('m3e-dialog[aria-label="削除要求"]')
        dialog_surface=page.get_by_role('dialog',name='削除要求',exact=True)
        def open_delete(row,label):
            button=row.get_by_role('button',name='投稿の操作',exact=True)
            button.focus();expect(button).to_be_focused();button.press('Enter')
            option=page.get_by_role('menuitem',name=label,exact=True)
            expect(option).to_be_visible()
            option.focus();option.press('Enter')
            expect(dialog_surface).to_be_visible()
            assert '#/thread/' not in page.url
            return button
        open_delete(repost,'リポストの削除を要求')
        page.keyboard.press('Escape');expect(dialog_surface).not_to_be_visible();expect(menu).to_be_focused()
        assert page.evaluate('qa.deletions.length===0 && qa.signed.length===0')
        open_delete(repost,'リポストの削除を要求')
        page.evaluate("qa.mode='hold'")
        confirm=dialog.get_by_role('button',name='署名して削除を要求',exact=True)
        confirm.click();page.wait_for_function('qa.signed.length===1')
        page.keyboard.press('Enter')
        assert page.evaluate('qa.signed.length===1 && qa.deletions.length===0')
        page.evaluate("qa.mode='success';qa.release()")
        expect(dialog).to_contain_text('1/1リレーで削除要求を確認しました')
        expect(repost).to_contain_text('削除要求済みのリポスト')
        expect(source).to_contain_text('小さな発見を、みんなで。')
        expect(source.get_by_role('button',name='リポスト',exact=True)).to_be_visible()
        event=page.evaluate('qa.deletions[0].event')
        assert event['kind']==5 and event['tags']==[['e',ids['repost']],['k','6']]
        assert page.evaluate("qa.deletions.length===1 && qa.deletions[0].url==='wss://write.example/'")
        page.keyboard.press('Escape');expect(dialog_surface).not_to_be_visible();expect(repost).to_be_focused()
        # An owned note still supports deletion, independent of its repost control.
        open_delete(own,'投稿の削除を要求')
        page.evaluate("qa.mode='cancel'")
        dialog.get_by_role('button',name='署名して削除を要求',exact=True).click()
        expect(dialog).to_contain_text('署名がキャンセルされました')
        assert page.evaluate('qa.deletions.length===1')
        expect(own).to_contain_text('Synthetic owned note')
        page.evaluate("qa.mode='success'")
        dialog.get_by_role('button',name='署名して削除を要求',exact=True).click()
        expect(own).to_contain_text('削除要求済みの投稿')
        note_event=page.evaluate('qa.deletions[1].event')
        assert note_event['kind']==5 and note_event['tags']==[['e',ids['note']],['k','1']]
        page.keyboard.press('Escape');expect(dialog_surface).not_to_be_visible();expect(own).to_be_focused()
        assert page.evaluate('qa.deletions.length===2 && qa.published.length===0')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        results.append({'viewport':width,'guest_ownership':True,'both_menus':True,'repost_deletion':True,'original_preserved':True,'note_deletion':True,'cancel_retry':True,'focus_return':True,'errors':errors})
        page.close()
    browser.close()
    print(json.dumps(results,ensure_ascii=False,indent=2))
