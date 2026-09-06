/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only: the backend runs on its own port (default 3001, see
    // backend/src/index.ts). Production deployment needs its own
    // same-origin/reverse-proxy config (nginx, per root CLAUDE.md) — not
    // set up yet, flagged as a follow-up rather than assumed solved here.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
})
