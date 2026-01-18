import { config } from 'dotenv'
import { join } from 'path'

// Load environment variables from .env file
config()

import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupIpcHandlers } from './ipc'
import { createMenu } from './menu'
import { getMcpHttpServer, getMcpBridge } from './mcp'

console.log('[Main] Environment loaded. OCR URL:', process.env.REMARKABLE_OCR_URL ? 'set' : 'not set')

// Enable remote debugging in dev mode for QA automation (Circuit Electron, Playwright)
if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// Track file path to open (from command line or open-file event)
let fileToOpen: string | null = null

// Handle file open from macOS Finder (before app is ready)
app.on('open-file', (event, path) => {
  event.preventDefault()
  fileToOpen = path

  // If app is already running, send to renderer
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (mainWindow) {
    mainWindow.webContents.send('file:openExternal', path)
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.prose.app')

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

  // Set up MCP bridge with main window for tool execution
  const bridge = getMcpBridge()
  bridge.setWindow(mainWindow)

  // Connect HTTP MCP server to bridge for tool execution
  mcpServer.setToolInvokeHandler(async (name, args) => {
    return bridge.executeTool(name, args)
  })

  // Send MCP status and file to renderer once loaded
  mainWindow.webContents.once('did-finish-load', () => {
    // Send MCP server status to renderer
    mainWindow.webContents.send('mcp:status', {
      connected: mcpStarted,
      port: MCP_PORT,
      error: mcpStarted ? undefined : 'Port may be in use'
    })

    // Send file if one was specified
    if (fileToOpen) {
      mainWindow.webContents.send('file:openExternal', fileToOpen)
    }
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
