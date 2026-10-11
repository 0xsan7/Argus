FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/src ./src
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
RUN npm run build

FROM python:3.14-slim
WORKDIR /app
COPY backend/requirements.deploy.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY artifacts/timeline.json artifacts/metrics.json artifacts/run_manifest.json ./artifacts/
COPY --from=frontend /build/dist ./frontend/dist
ENV PORT=8080 USE_FIXTURES=0 ARGUS_CORS_ORIGINS="" ARGUS_WEB_DIST=/app/frontend/dist NOTES_CACHE_PATH=/tmp/argus-notes-cache.json GEMMA_TIMEOUT_S=1
USER 10001:10001
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.app.web:app --host 0.0.0.0 --port ${PORT:-8080}"]
