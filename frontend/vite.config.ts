import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const api = `http://127.0.0.1:${process.env.ARGUS_API_PORT || '8000'}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/investigation/v1': { target: api, changeOrigin: false },
      '/api': api,
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
})
