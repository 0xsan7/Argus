import { defineConfig } from '@playwright/test'

const apiPort = process.env.ARGUS_TEST_API_PORT || '18080'
const webPort = process.env.ARGUS_TEST_WEB_PORT || '15173'

export default defineConfig({
  testDir: './tests/browser',
  outputDir: '../runtime/browser-results',
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${webPort}`, channel: 'chrome', headless: true, viewport: { width: 1280, height: 1000 } },
  webServer: [
    { command: `cd .. && USE_FIXTURES=1 GEMMA_TIMEOUT_S=1 .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port ${apiPort}`, url: `http://127.0.0.1:${apiPort}/api/health`, reuseExistingServer: false },
    { command: `ARGUS_API_PORT=${apiPort} npm run dev -- --port ${webPort}`, url: `http://127.0.0.1:${webPort}`, reuseExistingServer: false },
  ],
})
