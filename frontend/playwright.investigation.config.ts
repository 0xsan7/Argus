import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/investigation',
  outputDir: '../runtime/investigation-browser-results',
  reporter: 'list',
  use: {
    baseURL: process.env.ARGUS_INVESTIGATION_WEB_URL || 'http://127.0.0.1:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 960 },
  },
})
