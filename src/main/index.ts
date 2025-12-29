import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupIpcHandlers } from './ipc'
import { createMenu } from './menu'

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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.prose.app')

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

  // Send file to renderer once loaded
  if (fileToOpen) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('file:openExternal', fileToOpen)
    })
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
