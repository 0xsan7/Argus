import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  outputDir: '../runtime/browser-results',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:15173', channel: 'chrome', headless: true, viewport: { width: 1280, height: 1000 } },
  webServer: [
    { command: 'USE_FIXTURES=1 ../.venv/bin/python -m uvicorn backend.app.main:app --app-dir .. --host 127.0.0.1 --port 18080', url: 'http://127.0.0.1:18080/api/health', reuseExistingServer: false },
    { command: 'VIGIL_API_PORT=18080 npm run dev -- --port 15173', url: 'http://127.0.0.1:15173', reuseExistingServer: false },
  ],
})
