import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolveClientConfig } from './src/config/env.js'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // One .env at the repository root serves both client and server.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env }

  // Fail the dev server / build immediately on malformed VITE_* URLs.
  resolveClientConfig(env)

  // Dev-only proxy so the default same-origin config (/api, /socket.io)
  // reaches the backend without CORS or hard-coded hosts in the bundle.
  const backend = `http://localhost:${env.PORT || 5000}`

  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/socket.io': { target: backend, changeOrigin: true, ws: true },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.{js,jsx}'],
      setupFiles: ['tests/setup.js'],
      restoreMocks: true,
    },
  }
})
