import { defineConfig, devices } from '@playwright/test'

const API_PORT = 5100
const WEB_PORT = 4173
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
const isCI = Boolean(process.env.CI)

/**
 * E2E runs against the production client bundle (vite build + preview) and
 * the real backend with an ephemeral MongoDB. The client is built with an
 * absolute, cross-origin API URL so CORS is exercised exactly as deployed
 * separately. Output goes to dist-e2e so it never clobbers `npm run build`.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node scripts/e2e-backend.js',
      // Playwright polls until readiness is 200: no arbitrary sleeps.
      url: `${API_ORIGIN}/ready`,
      env: {
        E2E_API_PORT: String(API_PORT),
        E2E_CLIENT_ORIGIN: WEB_ORIGIN,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      // Request logs are written to e2e-logs/backend.log; startup errors still
      // surface here via stderr.
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npm run build -w apps/client -- --outDir dist-e2e && npm run preview -w apps/client -- --outDir dist-e2e --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      env: {
        VITE_API_URL: `${API_ORIGIN}/api`,
        VITE_SOCKET_URL: API_ORIGIN,
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
