import json
import urllib.error
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services.note_bridge import NoteBridge, BridgeBusy, NoRedirect


NOTE = {'window_id': 0, 'source': 'gemma', 'model': 'gemma4:e2b-mlx',
        'threat_summary': 'Local generated report', 'why_suspicious': 'Review traffic',
        'suggested_checks': ['Check logs'], 'caveat': 'Verify before acting'}


def bridge_app(monkeypatch, origin='https://argus-test.trycloudflare.com', token='controlled-bridge-secret'):
    monkeypatch.setenv('ARGUS_NOTE_ORIGIN', origin)
    monkeypatch.setenv('ARGUS_NOTE_TOKEN', token)
    return create_app(use_fixtures=True)


def test_hosted_note_uses_authenticated_bridge_and_forwards_only_window_identity(monkeypatch):
    app = bridge_app(monkeypatch)
    remote = MagicMock()
    remote.__enter__.return_value.read.return_value = json.dumps(NOTE).encode()
    with patch('urllib.request.OpenerDirector.open', return_value=remote) as transport, \
         patch('backend.app.main.generate_note') as local_model:
        result = TestClient(app).post('/api/windows/0/note?refresh=true')
    assert result.json() == NOTE
    local_model.assert_not_called()
    req = transport.call_args.args[0]
    assert req.full_url == 'https://argus-test.trycloudflare.com/api/windows/0/note?refresh=true'
    assert req.get_header('Authorization') == 'Bearer controlled-bridge-secret'
    assert req.get_header('X-argus-run-id')
    assert req.data == b''


@pytest.mark.parametrize('origin,token', [
    ('http://argus-test.trycloudflare.com', 'secret'),
    ('https://user:password@argus-test.trycloudflare.com', 'secret'),
    ('https://argus-test.trycloudflare.com/path', 'secret'),
    ('https://argus-test.trycloudflare.com', ''),
])
def test_invalid_bridge_configuration_falls_back_without_sending_credentials(monkeypatch, origin, token):
    app = bridge_app(monkeypatch, origin, token)
    with patch('urllib.request.OpenerDirector.open') as transport, patch('backend.app.main.generate_note') as local_model:
        result = TestClient(app).post('/api/windows/0/note')
    assert result.json()['source'] == 'template'
    transport.assert_not_called()
    local_model.assert_not_called()


def test_notes_only_tunnel_rejects_anonymous_calls_and_other_routes(monkeypatch):
    monkeypatch.setenv('ARGUS_API_TOKEN', 'controlled-bridge-secret')
    monkeypatch.setenv('ARGUS_NOTE_BRIDGE_ONLY', '1')
    client = TestClient(create_app(use_fixtures=True))
    assert client.post('/api/windows/0/note').status_code == 401
    headers = {'Authorization': 'Bearer controlled-bridge-secret'}
    assert client.get('/api/health', headers=headers).status_code == 200
    for path in ['/api/timeline', '/api/windows/0', '/docs', '/openapi.json']:
        assert client.get(path, headers=headers).status_code == 404


def test_notes_only_tunnel_refuses_a_different_artifact_run(monkeypatch):
    monkeypatch.setenv('ARGUS_API_TOKEN', 'controlled-bridge-secret')
    monkeypatch.setenv('ARGUS_NOTE_BRIDGE_ONLY', '1')
    with patch('backend.app.main.generate_note') as model:
        result = TestClient(create_app(use_fixtures=True)).post('/api/windows/0/note', headers={
            'Authorization': 'Bearer controlled-bridge-secret', 'X-Argus-Run-Id': 'different-run',
        })
    assert result.status_code == 409
    model.assert_not_called()


@pytest.mark.parametrize('payload', [
    {**NOTE, 'window_id': 1},
    {**NOTE, 'source': 'unknown'},
    {**NOTE, 'suggested_checks': []},
    {key: value for key, value in {**NOTE, 'source': 'template'}.items() if key != 'model'},
    'invalid json',
    'x' * 65537,
])
def test_invalid_remote_reports_return_a_complete_template(monkeypatch, payload):
    app = bridge_app(monkeypatch)
    remote = MagicMock()
    remote.__enter__.return_value.read.return_value = (
        payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
    )
    with patch('urllib.request.OpenerDirector.open', return_value=remote):
        result = TestClient(app).post('/api/windows/0/note')
    assert result.status_code == 200
    assert result.json()['source'] == 'template'
    assert result.json()['model'] is None
    assert result.json()['suggested_checks']


def test_offline_bridge_returns_template_without_trying_hosted_ollama(monkeypatch):
    app = bridge_app(monkeypatch)
    with patch('urllib.request.OpenerDirector.open', side_effect=urllib.error.URLError('Offline')), \
         patch('backend.app.main.generate_note') as local_model:
        result = TestClient(app).post('/api/windows/0/note')
    assert result.json()['source'] == 'template'
    local_model.assert_not_called()


def test_bridge_concurrency_and_rate_limit_return_readable_retry(monkeypatch):
    bridge_app(monkeypatch)
    bridge = NoteBridge()
    bridge.lock.acquire()
    with pytest.raises(BridgeBusy):
        bridge.generate(0, 'test-run', False)
    bridge.lock.release()
    with patch('urllib.request.OpenerDirector.open', side_effect=urllib.error.URLError('Offline')) as transport, \
         patch('backend.app.services.note_bridge.time.monotonic', return_value=100):
        for _ in range(10):
            assert bridge.generate(0, 'test-run', False) is None
        with pytest.raises(BridgeBusy):
            bridge.generate(0, 'test-run', False)
        assert transport.call_count == 10
    with patch('backend.app.main.NoteBridge.generate', side_effect=BridgeBusy):
        result = TestClient(create_app(use_fixtures=True)).post('/api/windows/0/note')
    assert result.status_code == 429
    assert result.headers['Retry-After'] == '60'
    assert result.json() == {'error': 'Gemma is busy. Please retry shortly.'}


def test_bridge_never_forwards_its_token_on_a_redirect():
    assert NoRedirect().redirect_request(None, None, 302, '', {}, 'https://another-host.test') is None


def test_notes_only_mode_fails_closed_without_token(monkeypatch):
    monkeypatch.setenv('ARGUS_NOTE_BRIDGE_ONLY', '1')
    monkeypatch.delenv('ARGUS_API_TOKEN', raising=False)
    with pytest.raises(ValueError, match='requires ARGUS_API_TOKEN'):
        create_app(use_fixtures=True)
