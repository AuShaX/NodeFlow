/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // one yjs instance only: y-websocket is CJS and would otherwise get its own
  // inlined copy from the dep optimizer (yjs/yjs#438 — breaks instanceof)
  resolve: { dedupe: ['yjs'] },
  optimizeDeps: { include: ['yjs', 'y-websocket', 'y-indexeddb', 'y-protocols/awareness'] },
  // honor a port assigned by preview tooling (PORT env); default otherwise
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
