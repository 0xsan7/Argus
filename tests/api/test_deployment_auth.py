from fastapi.testclient import TestClient
from backend.app.main import create_app


def test_deployed_backend_requires_server_token(monkeypatch):
    monkeypatch.setenv('ARGUS_API_TOKEN', 'controlled-test-secret')
    with TestClient(create_app(use_fixtures=True)) as client:
        assert client.get('/api/meta').status_code == 401
        assert client.post('/api/windows/0/note').status_code == 401
        assert client.get('/api/meta', headers={'Authorization': 'Bearer wrong'}).status_code == 401
        assert client.get('/api/meta', headers={'Authorization': 'Bearer controlled-test-secret'}).status_code == 200


def test_local_backend_remains_usable_without_deployment_token(monkeypatch):
    monkeypatch.delenv('ARGUS_API_TOKEN', raising=False)
    with TestClient(create_app(use_fixtures=True)) as client:
        assert client.get('/api/meta').status_code == 200
