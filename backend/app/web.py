"""Production entry point: serve the compiled console and API on one port."""
import os
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from backend.app.main import create_app


class ConsoleFiles(StaticFiles):
    async def get_response(self, path, scope):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(status_code=404)
        if path.rstrip('/') in {'models', 'about'}:
            path = 'index.html'
        return await super().get_response(path, scope)


def create_web_app(dist: Path | None = None, use_fixtures: bool = False):
    app = create_app(use_fixtures=use_fixtures)

    @app.exception_handler(Exception)
    async def public_exception_handler(request: Request, exc: Exception):
        return JSONResponse(status_code=500, content={'error': 'Internal server error'})

    @app.middleware('http')
    async def deployment_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        )
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        elif 'text/html' in response.headers.get('content-type', ''):
            # Keep proxy-injected analytics out of the offline-first console.
            response.headers['Cache-Control'] = 'public, no-cache, no-transform'
        return response

    frontend = dist if dist is not None else Path(os.environ.get('ARGUS_WEB_DIST', 'frontend/dist'))
    app.mount('/', ConsoleFiles(directory=frontend, html=True), name='console')
    return app


app = create_web_app()
