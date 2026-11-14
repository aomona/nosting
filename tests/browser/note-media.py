"""Run node tests/browser/server.mjs, then python tests/browser/note-media.py.
Requires Playwright, Pillow, ffmpeg and Chromium. No relay or signer is used.
All remote requests are intercepted; screenshots/media stay outside the repo.
"""
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw
from io import BytesIO
import json
import os
import shutil
import subprocess
import tempfile


def picture(name):
 size = (600, 900) if name == 'portrait.png' else (900, 600)
 frames = []
 for color in ['#778c64', '#ad7558']:
  img = Image.new('RGB', size, '#dee8d4')
  draw = ImageDraw.Draw(img)
  draw.ellipse((size[0]*.65, 50, size[0]*.85, 50+size[0]*.2), fill='#f2cb77')
  draw.polygon([(0, size[1]), (size[0]*.4, size[1]*.2), size], fill=color)
  frames.append(img)
 out = BytesIO()
 fmt = 'GIF' if name.endswith('.gif') else 'WEBP' if name.endswith('.webp') else 'PNG'
 frames[0].save(out, format=fmt, **({'save_all':True, 'append_images':frames[1:], 'duration':200, 'loop':0} if fmt == 'GIF' else {}))
 return out.getvalue(), 'image/'+fmt.lower()


with tempfile.TemporaryDirectory(prefix='nosting-media-') as tmp, sync_playwright() as p:
 video_path = tmp+'/clip.webm'
 subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:d=1', '-c:v', 'libvpx', video_path], check=True)
 video = open(video_path, 'rb').read()
 browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
 results = []
 for width, height, motion in [(1280, 900, 'reduce'), (390, 844, 'reduce'), (320, 740, 'reduce'), (1280, 900, 'no-preference')]:
  context = browser.new_context(viewport={'width':width, 'height':height}, has_touch=width<600, is_mobile=width<600, reduced_motion=motion)
  page = context.new_page()
  page.set_default_timeout(10000)
  errors, external, requested = [], [], []
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
  def route(request):
   url = request.request.url
   if url.startswith('http://127.0.0.1:4174/'):
    request.continue_()
   elif url.startswith('https://media.example.test/'):
    name = url.rsplit('/', 1)[-1]
    requested.append(name)
    body, mime = (video, 'video/webm') if name.endswith('.webm') else picture(name)
    request.fulfill(status=200, body=body, content_type=mime)
   else:
    external.append(url)
    request.abort()
  page.route('**/*', route)
  # Intercept remote sockets without closing Vite's local HMR socket/retry loop.
  page.route_web_socket('wss://**/*', lambda ws: None)
  page.goto('http://127.0.0.1:4174/tests/browser/note-media.html')
  page.wait_for_function("customElements.get('m3e-dialog') && document.querySelectorAll('#mixed .petal-media-card').length===6")
  strips = page.locator('#mixed .petal-media-strip')
  assert strips.count() == 2
  assert [strips.nth(i).locator('.petal-media-card').count() for i in range(2)] == [2, 4]
  assert page.locator('#mixed .petal-markdown').evaluate("e=>Array.from(e.children).map(n=>n.classList.contains('petal-media-group')?'media':n.textContent)") == ['画像の前', 'media', '画像の間', 'media', '画像の後']
  assert page.locator('#mixed img').first.get_attribute('alt') == '横長の画像'
  assert page.locator('#mixed img').nth(1).get_attribute('width') == '600'
  assert page.locator('#mixed img').nth(2).get_attribute('src').endswith('.gif')
  assert page.locator('#sensitive .petal-note-media').count() == 0
  assert page.locator('#single .petal-media-strip').count() == 0
  assert page.locator('#single .petal-note-media').get_attribute('tabindex') is None
  for strip in page.locator('.petal-media-strip').all():
   assert strip.evaluate('e=>e.scrollWidth>e.clientWidth')
   assert strip.evaluate('e=>new Set(Array.from(e.children).map(n=>n.offsetTop)).size===1')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert 'clip.webm' not in requested, 'video must remain opt-in'
  assert page.locator('#single .petal-media-nav').count() == 0
  group = strips.nth(1).locator('..')
  previous = group.get_by_label('前の画像・動画')
  next_button = group.get_by_label('次の画像・動画')
  assert next_button.get_attribute('aria-controls') == strips.nth(1).get_attribute('id')
  assert next_button.evaluate('e=>getComputedStyle(e).opacity') == '0'
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-next')[1].getAttribute('aria-disabled')!=='true'")
  assert previous.get_attribute('aria-disabled') == 'true'
  if width >= 600:
   group.hover()
   assert next_button.evaluate('e=>getComputedStyle(e).opacity') == '1'
   page.screenshot(path=f'/tmp/nosting-media-{width}-hover.png')
  # Tab can reach the controls even before hover; focus keeps them visible.
  previous.focus()
  page.keyboard.press('Tab')
  assert next_button.evaluate('e=>document.activeElement===e && getComputedStyle(e).opacity==="1"')
  page.evaluate("""()=>{
   qa.scrollBehaviors=[];
   const original=Element.prototype.scrollTo;
   Element.prototype.scrollTo=function(options){qa.scrollBehaviors.push(options.behavior);return original.apply(this,arguments)};
  }""")
  second = strips.nth(1)
  step = second.evaluate('e=>e.children[1].getBoundingClientRect().left-e.children[0].getBoundingClientRect().left')
  maximum = second.evaluate('e=>e.scrollWidth-e.clientWidth')
  page.keyboard.press('Enter')
  page.wait_for_function('(target)=>Math.abs(document.querySelectorAll("#mixed .petal-media-strip")[1].scrollLeft-target)<1', arg=min(step,maximum))
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-previous')[1].getAttribute('aria-disabled')!=='true'")
  next_button.click()
  page.wait_for_function('(target)=>Math.abs(document.querySelectorAll("#mixed .petal-media-strip")[1].scrollLeft-target)<1', arg=min(step*2,maximum))
  next_button.click()
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-next')[1].getAttribute('aria-disabled')==='true'")
  assert next_button.evaluate('e=>document.activeElement===e'), 'end control must retain keyboard focus'
  end = second.evaluate('e=>e.scrollLeft')
  box = next_button.bounding_box()
  page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2)
  assert second.evaluate('e=>e.scrollLeft') == end
  assert page.evaluate('qa.opened') == 0
  # Resize can make every card fit; both controls then become unavailable.
  second.evaluate('e=>{e.style.maxWidth="none";e.style.width="1600px"}')
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-previous')[1].getAttribute('aria-disabled')==='true' && document.querySelectorAll('#mixed .petal-media-next')[1].getAttribute('aria-disabled')==='true'")
  second.evaluate('e=>{e.style.removeProperty("width");e.style.removeProperty("max-width");e.scrollTo({left:0,behavior:"instant"})}')
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-next')[1].getAttribute('aria-disabled')!=='true'")
  second.evaluate('e=>e.scrollTo({left:e.scrollWidth,behavior:"instant"})')
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-previous')[1].getAttribute('aria-disabled')!=='true'")
  previous.click()
  page.wait_for_function('(end)=>document.querySelectorAll("#mixed .petal-media-strip")[1].scrollLeft<end-1',arg=end)
  second.evaluate('e=>e.scrollTo({left:0,behavior:"instant"})')
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-previous')[1].getAttribute('aria-disabled')==='true'")
  previous.focus()
  page.keyboard.press('Enter')
  assert second.evaluate('e=>e.scrollLeft') == 0
  expected_behavior = 'instant' if motion == 'reduce' else 'smooth'
  assert page.evaluate('qa.scrollBehaviors.slice(0,3)') == [expected_behavior]*3
  page.locator('h1').click()
  page.mouse.move(0,0)
  assert next_button.evaluate('e=>getComputedStyle(e).opacity') == '0'
  first = strips.first
  page.keyboard.press('Tab')
  first.focus()
  assert first.evaluate('e=>e.matches(":focus-visible") && getComputedStyle(e).outlineStyle!=="none"')
  page.keyboard.press('ArrowRight')
  page.wait_for_function("document.querySelector('#mixed .petal-media-strip').scrollLeft>0")
  first.evaluate('e=>e.scrollLeft=0')
  page.keyboard.press('Tab')
  page.keyboard.press('Enter')
  dialog = page.locator('#mixed m3e-dialog')
  dialog.wait_for()
  page.wait_for_function("document.querySelector('#mixed m3e-dialog').open")
  assert dialog.locator('img').get_attribute('src').endswith('landscape.png')
  assert page.evaluate('qa.opened') == 0
  page.screenshot(path=f'/tmp/nosting-media-{width}-expanded.png')
  page.keyboard.press('Escape')
  dialog.wait_for(state='detached')
  # Pointer activation must still work after the keyboard focus reveal scroll.
  first.locator('m3e-icon-button').first.click()
  page.wait_for_function("document.querySelector('#mixed m3e-dialog')?.open")
  page.keyboard.press('Escape')
  dialog.wait_for(state='detached')
  # Tabbing to an offscreen card must reveal its expand control.
  page.keyboard.press('Tab')
  page.wait_for_function("document.querySelector('#mixed .petal-media-strip').scrollLeft>0")
  assert first.evaluate('e=>document.activeElement.getBoundingClientRect().right<=e.getBoundingClientRect().right')
  page.keyboard.press('Enter')
  page.wait_for_function("document.querySelector('#mixed m3e-dialog')?.open")
  assert page.locator('#mixed m3e-dialog img').get_attribute('src').endswith('portrait.png')
  page.keyboard.press('Escape')
  dialog.wait_for(state='detached')
  # Actual touch gesture on mobile; horizontal wheel/trackpad on desktop.
  second = strips.nth(1)
  second.scroll_into_view_if_needed()
  box = second.bounding_box()
  if width < 600:
   cdp = context.new_cdp_session(page)
   x, y = box['x']+box['width']*.85, box['y']+40
   cdp.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':[{'x':x, 'y':y}]})
   for step in range(1, 9):
    cdp.send('Input.dispatchTouchEvent', {'type':'touchMove', 'touchPoints':[{'x':x-step*box['width']*.08, 'y':y}]})
   cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd', 'touchPoints':[]})
  else:
   page.mouse.move(box['x']+80, box['y']+40)
   page.mouse.wheel(400, 0)
  page.wait_for_function("document.querySelectorAll('#mixed .petal-media-strip')[1].scrollLeft>0")
  assert page.evaluate('qa.opened') == 0
  page.locator('#mixed m3e-button').filter(has_text='動画を読み込む').click()
  page.wait_for_function("document.querySelector('#mixed video')?.readyState>=1")
  assert page.locator('#mixed video').evaluate('e=>e.controls && e.playsInline')
  page.locator('#mixed video').evaluate('e=>e.play()')
  page.wait_for_function("document.querySelector('#mixed video').currentTime>0")
  sensitive = page.locator('#sensitive')
  sensitive.locator('m3e-button').filter(has_text='表示する').click()
  assert sensitive.locator('.petal-media-strip').count() == 2
  sensitive.locator('m3e-button').filter(has_text='隠す').click()
  assert sensitive.locator('.petal-note-media').count() == 0
  sensitive.screenshot(path=f'/tmp/nosting-media-{width}-hidden.png')
  sensitive.locator('m3e-button').filter(has_text='表示する').click()
  assert sensitive.locator('video').count() == 0
  page.locator('#mixed').scroll_into_view_if_needed()
  first.evaluate('e=>e.scrollLeft=0')
  second.evaluate('e=>e.scrollLeft=0')
  page.evaluate('window.scrollTo(0,0)')
  first.focus()
  page.wait_for_function("document.querySelector('#mixed .petal-media-previous').getAttribute('aria-disabled')==='true' && document.querySelector('#mixed .petal-media-next').getAttribute('aria-disabled')!=='true'")
  page.screenshot(path=f'/tmp/nosting-media-{width}-row.png')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors, errors
  assert not external, external
  results.append({'viewport':width, 'motion':motion, 'hover_focus_arrows':True, 'one_card_steps_and_edges':True, 'resize':True, 'order_and_metadata':True, 'horizontal_scroll':True, 'keyboard_expand_escape':True, 'touch_swipe':width<600, 'video_playback':True, 'sensitive_toggle':True, 'page_overflow':False, 'console_errors':errors})
  context.close()
 print(json.dumps(results, ensure_ascii=False, indent=2))
 browser.close()
