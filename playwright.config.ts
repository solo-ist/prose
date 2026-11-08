import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/smoke.spec.ts', '**/electron.*.spec.ts'],
  timeout: 30_000,
  // Whole-suite cap, a hang guard rather than a budget: the suite takes 8.5–10 min on the
  // CI runner (one worker) after the 1.9.1 work, and a retried flake pushed it past the old
  // 10-minute cap (#1272). Stays under the job's timeout-minutes (30), which also covers
  // setup and the build. Sharding is the next step if it keeps growing.
  globalTimeout: 1_200_000,
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
