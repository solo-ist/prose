import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { config } from 'dotenv'
import type { Plugin } from 'vite'

// Load .env so SENTRY_AUTH_TOKEN is available at config evaluation time
config()

// Conditionally load Sentry Vite plugin for source map upload
const getSentryPlugin = async (): Promise<Plugin | null> => {
  if (!process.env.SENTRY_AUTH_TOKEN) return null
  try {
    const { sentryVitePlugin } = await import('@sentry/vite-plugin')
    return sentryVitePlugin({
      org: 'soloist',
      project: 'prose',
      authToken: process.env.SENTRY_AUTH_TOKEN
    })
  } catch {
    return null
  }
}

export default defineConfig(async () => {
  const sentryPlugin = await getSentryPlugin()

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: {
        sourcemap: true,
        rollupOptions: {
          external: [
            /^@modelcontextprotocol\/sdk/,
            'zod-to-json-schema'
          ]
        }
      }
    },
    preload: {
      // electron-vite v5 forces ESM (.mjs) when package.json has "type": "module",
      // but Electron's sandboxed preloads require CJS. The preload is built separately
      // via esbuild (see build:preload script) — this section is intentionally empty.
    },
    renderer: {
      plugins: [react(), ...(sentryPlugin ? [sentryPlugin] : [])],
      build: {
        sourcemap: true
      }
    }
  }
})
