import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/web.spec.ts',
  timeout: 30_000,
  globalTimeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: process.env.CI
    ? [
        ['json', { outputFile: 'test-results-web.json' }],
        ['github'],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite preview --config vite.web.config.ts --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
})
