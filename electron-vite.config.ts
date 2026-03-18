import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Get git commit hash at build time
const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [
          /^@modelcontextprotocol\/sdk/,
          'zod-to-json-schema'
        ]
      }
    }
  },
  preload: {
    // "type": "module" in package.json makes electron-vite output ESM (.mjs)
    // which works with sandbox: true (CJS require('electron') doesn't)
  },
  renderer: {
    plugins: [react()],
    define: {
      __GIT_HASH__: JSON.stringify(getGitHash())
    }
  }
})
