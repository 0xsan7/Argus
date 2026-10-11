"""Run a separate authenticated backend for Cloudflare Tunnel, keeping local dev intact."""
import os
import secrets
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
os.chdir(root)
runtime = root / 'runtime'
runtime.mkdir(exist_ok=True)
token_file = runtime / 'cloudflare-api-token.txt'
if not token_file.exists():
    fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(secrets.token_urlsafe(48))
os.chmod(token_file, 0o600)
token = token_file.read_text().strip()
if len(token) < 32:
    raise SystemExit('Deployment token is invalid. Replace runtime/cloudflare-api-token.txt with a fresh random secret of at least 32 characters.')
os.environ['ARGUS_API_TOKEN'] = token
os.environ['USE_FIXTURES'] = '0'
os.environ['NOTES_CACHE_PATH'] = str(runtime / 'cloudflare-notes-cache.json')
os.environ['ARGUS_CORS_ORIGINS'] = ''
if '--notes-only' in sys.argv:
    os.environ['ARGUS_NOTE_BRIDGE_ONLY'] = '1'
    os.environ.pop('ARGUS_NOTE_ORIGIN', None)
    os.environ.pop('ARGUS_NOTE_TOKEN', None)
    os.environ['GEMMA_TIMEOUT_S'] = '60'
    print('Notes-only mode: only authenticated health and benchmark-note endpoints are exposed.', flush=True)
print('Authenticated real-data API: http://127.0.0.1:8001', flush=True)
print('Use runtime/cloudflare-api-token.txt as the private hosted bridge token. The token is not printed.', flush=True)
os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8001'])
