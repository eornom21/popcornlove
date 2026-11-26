import asyncio, json, os, sys, html
from playwright.async_api import async_playwright
import os.path
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT=8765
SITE=os.path.basename(ROOT)
OUT=ROOT+'/pin'; os.makedirs(OUT, exist_ok=True)
cat=json.load(open(ROOT+'/catalog.json'))
STY={'easy':('Little Kids','#FFC53D'),'whimsical':('Whimsical','#FF7AB6'),'realistic':('Realistic','#9CC6FF'),'intricate':('Intricate','#C9B5FF')}
TPL='''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="../fonts.css"><style>
*{box-sizing:border-box;margin:0;padding:0}body{width:1000px;height:1500px;background:#FFF6E5;overflow:hidden;position:relative;font-family:Nunito,sans-serif;color:#1D1B2F}
.dots{position:absolute;inset:0;background-image:radial-gradient(#E9DCC3 2.4px,transparent 2.6px);background-size:30px 30px}
.k{position:absolute;left:60px;top:54px;font:700 26px/1 Fredoka;letter-spacing:2px;background:#1D1B2F;color:#FFC53D;padding:13px 18px;border-radius:12px;transform:rotate(-2deg)}
.st{position:absolute;right:60px;top:52px;font:800 22px/1 Nunito;letter-spacing:1px;text-transform:uppercase;border:3.5px solid #1D1B2F;border-radius:12px;padding:12px 15px;background:%(col)s}
h1{position:absolute;left:60px;right:60px;top:128px;font:700 %(fs)spx/.98 Fredoka;letter-spacing:-1.5px}
h1 span{display:block;font-size:.58em;color:#F25C3B;letter-spacing:0;margin-top:10px}
.sheet{position:absolute;left:70px;top:%(top)spx;width:690px;border:5px solid #1D1B2F;border-radius:16px;background:#fff;box-shadow:12px 12px 0 #1D1B2F;transform:rotate(-3deg);overflow:hidden}
.sheet img,.col img{display:block;width:100%%}
.back{position:absolute;left:70px;top:%(top)spx;width:690px;height:920px;border:5px solid #1D1B2F;border-radius:16px;background:#FFC53D;transform:rotate(-8deg) translate(-10px,10px)}
.col{position:absolute;right:54px;bottom:150px;width:360px;border:5px solid #1D1B2F;border-radius:14px;background:#fff;box-shadow:9px 9px 0 #1D1B2F;transform:rotate(5deg);overflow:hidden}
.tag{position:absolute;right:40px;bottom:%(tagb)spx;font:700 24px/1 Fredoka;background:#2FAE69;color:#fff;border:4px solid #1D1B2F;border-radius:999px;padding:12px 18px;transform:rotate(-6deg);box-shadow:4px 4px 0 #1D1B2F}
.foot{position:absolute;left:0;right:0;bottom:0;height:96px;background:#1D1B2F;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 50px;font:700 30px/1 Fredoka}
.foot b{color:#FFC53D;font-weight:700}
</style></head><body><div class="k">FREE PRINTABLE</div><div class="st">%(sname)s</div>
<h1>%(title)s<span>Coloring Page</span></h1>
<div class="back"></div><div class="sheet"><img src="../art/%(id)s.webp"></div>
<div class="col"><img src="../guide/%(id)s.webp"></div><div class="tag">color guide included</div>
<div class="foot"><span>Print · PDF · Color online</span><b>makeacoloringbook.com</b></div></body></html>'''
def serve():
    import http.server, socketserver, threading, functools
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.dirname(ROOT))
    h.log_message = lambda *a, **k: None
    socketserver.TCPServer.allow_reuse_address = True
    try:
        srv = socketserver.TCPServer(("127.0.0.1", PORT), h)
    except OSError:
        return  # something is already serving the repo on this port
    threading.Thread(target=srv.serve_forever, daemon=True).start()

async def main(only=None):
    serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--no-proxy-server'])
        pg = await (await b.new_context(viewport={'width':1000,'height':1500}, device_scale_factor=0.8)).new_page()
        n=0
        for q in cat['pages']:
            if only and q['id'] not in only: continue
            t=q['n']; fs=96 if len(t)<=16 else (84 if len(t)<=22 else 72)
            lines=1 if len(t)*fs*0.5<880 else 2
            top=128+fs*lines+fs*0.58+60
            open(ROOT+'/_build/_pin_tmp.html','w').write(TPL%dict(col=STY[q['s']][1],sname=STY[q['s']][0],fs=fs,title=html.escape(t),id=q['id'],top=int(top),tagb=150+480+6))
            await pg.goto('http://127.0.0.1:%d/%s/_build/_pin_tmp.html?n=%d'%(PORT,SITE,n))
            await pg.wait_for_function("document.fonts.ready.then(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0))")
            await pg.screenshot(path=f"{OUT}/{q['id']}.jpg", type='jpeg', quality=72)
            n+=1
        print(n,'pins'); await b.close()
asyncio.run(main(set(sys.argv[1:]) or None))
