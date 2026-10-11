"""Send only a benchmark window identity to an authenticated local note bridge."""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque

from backend.app.services.gemma_client import is_complete_note


class BridgeBusy(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A redirect must never receive the private bridge token.
        return None


class NoteBridge:
    def __init__(self):
        self.origin = os.environ.get('ARGUS_NOTE_ORIGIN', '').strip()
        self.token = os.environ.get('ARGUS_NOTE_TOKEN', '').strip()
        self.configured = bool(self.origin or self.token)
        self.lock = threading.Lock()
        self.requests = deque()

    def generate(self, window_id: int, run_id: str, refresh: bool):
        try:
            url = urllib.parse.urlsplit(self.origin)
            valid = (url.scheme == 'https' and url.hostname and not url.username and not url.password
                     and url.path in ('', '/') and not url.query and not url.fragment
                     and bool(self.token) and '\n' not in self.token and '\r' not in self.token)
            if not valid:
                return None
        except ValueError:
            return None
        if not self.lock.acquire(blocking=False):
            raise BridgeBusy()
        try:
            now = time.monotonic()
            while self.requests and now - self.requests[0] >= 60:
                self.requests.popleft()
            if len(self.requests) >= 10:
                raise BridgeBusy()
            self.requests.append(now)
            path = f'/api/windows/{window_id}/note' + ('?refresh=true' if refresh else '')
            request = urllib.request.Request(self.origin.rstrip('/') + path, data=b'', method='POST', headers={
                'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json',
                'X-Argus-Run-Id': run_id,
            })
            opener = urllib.request.build_opener(NoRedirect())
            with opener.open(request, timeout=70) as response:
                payload = response.read(65537)
            if len(payload) > 65536:
                return None
            note = json.loads(payload)
            if not is_complete_note(note) or type(note.get('window_id')) is not int or note['window_id'] != window_id:
                return None
            if note.get('source') == 'gemma':
                if not isinstance(note.get('model'), str) or not note['model'].strip():
                    return None
            elif note.get('source') != 'template' or 'model' not in note or note['model'] is not None:
                return None
            return {key: note[key] for key in ('window_id', 'source', 'model', 'threat_summary',
                                              'why_suspicious', 'suggested_checks', 'caveat')}
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise BridgeBusy() from None
            return None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            return None
        finally:
            self.lock.release()
