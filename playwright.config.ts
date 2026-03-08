import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/smoke.spec.ts',
  timeout: 30_000,
  globalTimeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: process.env.CI
    ? [
        ['json', { outputFile: 'test-results.json' }],
        ['github'],
      ]
    : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
})
