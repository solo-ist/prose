import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the renderer (#1145). jsdom gives TipTap the DOM it needs to
 * build a headless editor; IndexedDB is mocked per test file. Run with
 * `npm run test:unit`.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/renderer/test/setup.ts'],
    css: false
  }
})
