"""Run node tests/browser/server.mjs, then python tests/browser/image-upload.py.
Uses a synthetic canvas JPEG, local signer/fetch mocks, and blocks external HTTP.
Screenshots are written to /tmp, never the repository.
"""
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
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:4174') else route.abort())
  page.goto('http://127.0.0.1:4174/tests/browser/image-upload.html')
  page.wait_for_function("customElements.get('m3e-button') && document.querySelector('input[type=file]')")
  def choose(mime='',size=0):
   page.evaluate("""async ({mime,size})=>{
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=640;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#dae8ca';ctx.fillRect(0,0,960,640);
    ctx.fillStyle='#607c50';ctx.beginPath();ctx.moveTo(0,640);ctx.lineTo(400,120);ctx.lineTo(960,640);ctx.fill();
    ctx.fillStyle='#f8ce69';ctx.beginPath();ctx.arc(760,140,65,0,Math.PI*2);ctx.fill();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
    const data=size?new Uint8Array(size):new Uint8Array(await blob.arrayBuffer());
    const dt=new DataTransfer();dt.items.add(new File([data],'CAMERA.JPG',{type:mime}));
    const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
   }""",{'mime':mime,'size':size})
  choose()
  page.locator('.petal-upload-preview img').wait_for()
  page.wait_for_function("document.querySelector('.petal-upload-preview img').naturalWidth===960")
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=f'/tmp/nosting-issue11-{width}-preview.png')
  page.locator('m3e-button').filter(has_text='アップロード').click()
  page.get_by_role('status').wait_for()
  assert page.evaluate("qa.requests.length===1 && qa.requests[0].type==='image/jpeg'")
  choose('image/jpg')
  page.locator('.petal-upload-preview').wait_for()
  page.evaluate("qa.error='画像は64 MP以下・各辺16,384 px以下にしてください'")
  page.locator('m3e-button').filter(has_text='アップロード').click()
  assert page.get_by_role('alert').inner_text()=='画像は64 MP以下・各辺16,384 px以下にしてください'
  page.screenshot(path=f'/tmp/nosting-issue11-{width}-dimensions.png')
  page.evaluate("qa.error='JPEGが壊れているか、対応していない形式です';qa.status=415")
  page.locator('m3e-button').filter(has_text='アップロード').click()
  page.get_by_role('alert').filter(has_text='JPEGが壊れている').wait_for()
  page.screenshot(path=f'/tmp/nosting-issue11-{width}-broken.png')
  before=page.evaluate('qa.requests.length')
  choose('image/jpeg',30_000_001)
  page.get_by_role('alert').filter(has_text='30 MB').wait_for()
  assert page.evaluate('qa.requests.length')==before
  assert not errors,errors
  results.append({'viewport':width,'empty_mime_preview':True,'canonical_signed_upload':True,'dimension_error':True,'broken_error':True,'30MB_preflight':True,'console_errors':errors})
  page.close()
 print(json.dumps(results,ensure_ascii=False,indent=2))
 browser.close()
