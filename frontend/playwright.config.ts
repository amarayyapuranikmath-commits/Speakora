import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests need the full stack running (PostgreSQL, Redis, backend on :8080, `npm run dev` on :5173).
 * Chromium is launched with a fake microphone so WebRTC audio negotiation can run without hardware.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
            // Chromium ignores the loopback interface for ICE; needed only because the local TURN test server is on 127.0.0.1.
            '--allow-loopback-in-peer-connection'],
        },
      },
    },
  ],
})
