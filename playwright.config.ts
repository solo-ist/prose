import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/smoke.spec.ts', '**/electron.*.spec.ts'],
  timeout: 30_000,
  // Whole-suite cap, a hang guard rather than a budget: the suite passed 5 min on the CI
  // runner (one worker) with the document-sessions cases (#1145) and the editor-state
  // series keeps adding to it. Stays well under the job's timeout-minutes (15).
  globalTimeout: 600_000,
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
