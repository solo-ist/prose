import { config } from 'dotenv'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'

// Load environment variables from .env file
// Use explicit path since Electron's CWD may differ from project root
const dotenvResult = config({ path: join(__dirname, '../../.env') })
if (dotenvResult.error) {
  // Fallback: try CWD (works in production)
  config()
}

import { app, shell, BrowserWindow, session, protocol, net } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupIpcHandlers } from './ipc'
import { createMenu } from './menu'
import { getMcpHttpServer, getMcpBridge, getMcpSocketServer } from './mcp'
import { initializeSpellcheck, setupContextMenu } from './spellcheck'

console.log('[Main] Environment loaded. OCR URL:', process.env.REMARKABLE_OCR_URL ? 'set' : 'not set')
console.log('[Main] Google configured:', process.env.GOOGLE_CLIENT_ID ? 'ID set' : 'ID missing', process.env.GOOGLE_CLIENT_SECRET ? 'Secret set' : 'Secret missing')

// Enable remote debugging in dev mode for QA automation (Circuit Electron, Playwright)
if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// Write PID file in dev mode for safe process cleanup by Claude Code agents
// This allows agents to kill only their own dev server instance
const pidFile = join(process.cwd(), '.dev.pid')
if (is.dev) {
  writeFileSync(pidFile, String(process.pid))
  console.log(`[Main] PID file written: ${pidFile} (${process.pid})`)

  // Clean up PID file on exit
  const cleanupPidFile = () => {
    try {
      if (existsSync(pidFile)) {
        unlinkSync(pidFile)
        console.log('[Main] PID file cleaned up')
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  process.on('exit', cleanupPidFile)
  process.on('SIGINT', () => { cleanupPidFile(); process.exit() })
  process.on('SIGTERM', () => { cleanupPidFile(); process.exit() })
}

// Track file path to open (from command line or open-file event)
let fileToOpen: string | null = null
// Track if renderer has signaled ready
let rendererReady = false
// Queue of file paths to open once renderer is ready
const pendingFileOpens: string[] = []

// Single instance lock - ensures only one instance of the app is running
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Another instance is already running - quit this one
  // The file path (if any) will be passed to the existing instance via second-instance event
  app.quit()
} else {
  // Handle second instance launch (another instance tried to start)
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Parse command line for file path
    const args = commandLine.slice(is.dev ? 2 : 1)
    for (const arg of args) {
      if (arg.endsWith('.md') && !arg.startsWith('-')) {
        // Focus main window and send file to renderer
        const mainWindow = BrowserWindow.getAllWindows()[0]
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
          mainWindow.webContents.send('file:openExternal', arg)
        }
        break
      }
    }
  })
}

// Handle file open from macOS Finder (before app is ready)
app.on('open-file', (event, path) => {
  event.preventDefault()

  // If renderer is ready, send immediately
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send('file:openExternal', path)
  } else {
    // Queue for later
    fileToOpen = path
    pendingFileOpens.push(path)
  }
})

// Check command line args for file path (Windows/Linux)
function getFileFromArgs(): string | null {
  // Skip electron executable and script path in dev, or just app path in prod
  const args = process.argv.slice(is.dev ? 2 : 1)
  for (const arg of args) {
    if (arg.endsWith('.md') && !arg.startsWith('-')) {
      return arg
    }
  }
  return null
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  let hasBeenShown = false
  mainWindow.on('ready-to-show', () => {
    if (!hasBeenShown) {
      mainWindow.show()
      hasBeenShown = true
    }
  })

  // Notify renderer of fullscreen changes (for traffic light padding)
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-change', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-change', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Register custom protocol for serving local image files
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.prose.app')

  // Handle local-file:// protocol to serve images from the filesystem
  protocol.handle('local-file', (request) => {
    // URL format: local-file:///absolute/path/to/image.png
    const filePath = decodeURIComponent(new URL(request.url).pathname)
    return net.fetch('file://' + filePath)
  })

  // Configure Content Security Policy
  // In development, we need 'unsafe-eval' for Vite HMR to work
  // In production, we use a stricter policy without 'unsafe-eval'
  const cspDirectives = [
    "default-src 'self'",
    is.dev ? "script-src 'self' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://api.anthropic.com https://api.openai.com https://openrouter.ai https://generativelanguage.googleapis.com https://accounts.google.com https://www.googleapis.com https://docs.googleapis.com https://oauth2.googleapis.com",
    "img-src 'self' data: https: local-file:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    responseHeaders['Content-Security-Policy'] = [cspDirectives]
    callback({ responseHeaders })
  })

  // Start HTTP/SSE server for MCP communication (Claude Desktop connects here)
  const mcpServer = getMcpHttpServer()
  const MCP_PORT = 9877
  let mcpStarted = false
  try {
    await mcpServer.start()
    mcpStarted = true
    console.log(`[Main] MCP HTTP server started on port ${MCP_PORT}`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.warn(`[Main] MCP server unavailable (port ${MCP_PORT} may be in use): ${errorMessage}`)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Check for file from command line args (Windows/Linux)
  if (!fileToOpen) {
    fileToOpen = getFileFromArgs()
  }

  const mainWindow = createWindow()
  setupIpcHandlers()
  createMenu(mainWindow)

  // Initialize spellcheck with personal dictionary
  await initializeSpellcheck()
  setupContextMenu(mainWindow)

  // Set up MCP bridge with main window for tool execution
  const bridge = getMcpBridge()
  bridge.setWindow(mainWindow)

  // Connect HTTP MCP server to bridge for tool execution
  mcpServer.setToolInvokeHandler(async (name, args) => {
    return bridge.executeTool(name, args)
  })

  // Send MCP status to renderer once loaded
  mainWindow.webContents.once('did-finish-load', () => {
    // Send MCP server status to renderer
    mainWindow.webContents.send('mcp:status', {
      connected: mcpStarted,
      port: MCP_PORT,
      error: mcpStarted ? undefined : 'Port may be in use'
    })

    // Note: Files are sent when renderer signals ready (not on did-finish-load)
    // This ensures the renderer has initialized its stores and is ready to handle files
  })

  // Handle renderer ready signal - this is called after settings and stores are initialized
  const { ipcMain } = await import('electron')
  ipcMain.handle('renderer:ready', async () => {
    rendererReady = true
    console.log('[Main] Renderer signaled ready')

    // Send any pending file opens
    // First, send the initial file (from command line or early open-file event)
    if (fileToOpen) {
      mainWindow.webContents.send('file:openExternal', fileToOpen)
      fileToOpen = null
    }

    // Then send any queued files (from open-file events while starting up)
    // Skip the first one if it was already sent as fileToOpen
    const filesToSend = pendingFileOpens.slice(1)
    for (const filePath of filesToSend) {
      mainWindow.webContents.send('file:openExternal', filePath)
    }
    pendingFileOpens.length = 0

    // Start MCP socket server now that renderer bridge is ready
    // All MCP tools require renderer, so we can only start after this point
    const socketServer = getMcpSocketServer()
    socketServer.setToolInvokeHandler((name, args) => bridge.executeTool(name, args))
    try {
      await socketServer.start()
      console.log('[Main] MCP socket server started')
    } catch (err) {
      console.warn('[Main] MCP socket server failed to start:', err instanceof Error ? err.message : err)
    }

    return { success: true }
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up socket server on quit
app.on('will-quit', async () => {
  const socketServer = getMcpSocketServer()
  await socketServer.stop()
})
