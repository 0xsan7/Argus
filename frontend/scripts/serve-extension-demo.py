"""Local, deliberately controlled website for demonstrating browser inspection.

No attacks are performed. All generated requests go to this loopback server.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,"><title>Argus local extension demo</title>
<style>body{background:#0a0e1a;color:#f8fafc;font:16px/1.6 system-ui;max-width:800px;margin:50px auto;padding:20px}a{color:#60a5fa}button{padding:12px;background:#2563eb;color:white;border:0;border-radius:4px;margin:5px}section{background:#0f1629;padding:24px;border:1px solid #1e2d4a}input{display:block;margin:10px 0}</style>
<h1>Argus local website inspection demo</h1>
<p>Controlled demonstration traffic, separate from the UNSW-NB15 benchmark. No real attacks or trained-model predictions.</p>
<p><a href="/">Normal page</a> · <a href="/exposure">Deliberate HTTP form issue</a></p>
<section><h2>Generate observable requests</h2><p>Pin Argus, open its popup, and click Inspect website. For continuous updates, click Expand dashboard and Start monitoring, then return here.</p>
<button id="normal">Send 5 normal local requests</button><button id="error">Send 3 controlled HTTP 503 responses</button>
<p id="status" role="status">Ready. Requests stay on this computer.</p></section>
__FORM__
<script>
async function run(endpoint,count){for(const b of document.querySelectorAll('button'))b.disabled=true;try{for(let i=0;i<count;i++){const response=await fetch(endpoint+'?n='+i,{cache:'no-store'});await response.arrayBuffer();await new Promise(r=>setTimeout(r,250));}document.querySelector('#status').textContent=count+' controlled requests finished. Inspect again or check monitoring.';}finally{for(const b of document.querySelectorAll('button'))b.disabled=false;}}
document.querySelector('#normal').onclick=()=>run('/data',5);
document.querySelector('#error').onclick=()=>run('/controlled-error',3);
</script></html>"""
FORM = """<section><h2>Deliberate demonstration issue</h2><p>This password form targets HTTP. Argus should report +35 rule points. It never reads the field value. Submitting is disabled; do not enter real credentials.</p><form action="http://127.0.0.1:8765/submit" onsubmit="return false"><input type="password" autocomplete="off" placeholder="Demo only — do not enter credentials"></form></section>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("/", "/exposure"):
            payload = PAGE.replace("__FORM__", FORM if path == "/exposure" else "").encode()
            status, content_type = 200, "text/html; charset=utf-8"
        elif path == "/data":
            payload, status, content_type = b'{"controlled_demo":true}', 200, "application/json"
        elif path == "/controlled-error":
            payload, status, content_type = b'{"error":"Deliberate demo response, not an attack"}', 503, "application/json"
        else:
            payload, status, content_type = b"Not found", 404, "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    print("Argus controlled website demo: http://127.0.0.1:8765", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
