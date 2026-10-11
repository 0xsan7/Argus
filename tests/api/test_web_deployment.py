from fastapi.testclient import TestClient


def test_public_app_serves_dashboard_and_direct_routes(tmp_path, monkeypatch):
    monkeypatch.delenv('ARGUS_API_TOKEN', raising=False)
    monkeypatch.setenv('ARGUS_CORS_ORIGINS', '')
    from backend.app.web import create_web_app
    dist = tmp_path / 'dist'
    dist.mkdir()
    (dist / 'index.html').write_text('<html>Controlled frontend build</html>')
    (dist / 'app.js').write_text('console.log("controlled")')
    app = create_web_app(dist, use_fixtures=True)
    with TestClient(app) as client:
        for path in ['/', '/models', '/about']:
            response = client.get(path)
            assert response.status_code == 200
            assert 'Controlled frontend build' in response.text
            assert response.headers['x-content-type-options'] == 'nosniff'
            assert response.headers['strict-transport-security'] == 'max-age=31536000'
            assert 'no-transform' in response.headers['cache-control']
        assert client.get('/app.js').status_code == 200
        assert client.get('/api/health').json()['mode'] == 'fixtures'
        assert client.get('/api/missing').status_code == 404
        assert client.get('/.env').status_code == 404
        assert client.get('/api/meta', headers={'Origin':'https://untrusted.example'}).headers.get('access-control-allow-origin') is None


def test_public_app_does_not_disclose_exception_details(tmp_path, monkeypatch):
    monkeypatch.delenv('ARGUS_API_TOKEN', raising=False)
    from backend.app.web import create_web_app
    (tmp_path / 'index.html').write_text('Controlled frontend')
    app = create_web_app(tmp_path, use_fixtures=True)

    @app.get('/unexpected-error')
    def error():
        raise RuntimeError('private deployment detail')

    # Register the failing test route ahead of the catch-all static mount.
    app.router.routes.insert(0, app.router.routes.pop())
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get('/unexpected-error')
        assert response.status_code == 500
        assert response.json() == {'error':'Internal server error'}
