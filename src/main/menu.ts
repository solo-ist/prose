import { Menu, BrowserWindow, app } from 'electron'
import { basename } from 'path'
import { loadRecentFiles, clearRecentFiles } from './recentFiles'

// Store mainWindow reference so we can rebuild the menu after adding recent files
let _menuWindow: BrowserWindow | null = null

// Helper to safely send menu actions to the focused window
function sendMenuAction(action: string): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:action', action)
  }
}

export function createMenu(mainWindow: BrowserWindow): void {
  _menuWindow = mainWindow
  const isMac = process.platform === 'darwin'
  const isGoogleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

  // Build "Open Recent" submenu from persisted recent files
  const recentFiles = loadRecentFiles().slice(0, 10)
  const openRecentSubmenu: Electron.MenuItemConstructorOptions[] = recentFiles.length > 0
    ? [
        ...recentFiles.map((filePath) => ({
          label: basename(filePath),
          click: (): void => {
            sendMenuAction(`openRecentFile:${filePath}`)
          }
        })),
        { type: 'separator' as const },
        {
          label: 'Show More...',
          click: (): void => {
            sendMenuAction('showRecentFiles')
          }
        },
        {
          label: 'Clear Recent Files',
          click: (): void => {
            clearRecentFiles()
            app.clearRecentDocuments()
            refreshMenu()
            // Notify renderer to update in-memory state
            sendMenuAction('clearRecentFiles')
          }
        }
      ]
    : [
        { label: 'No Recent Files', enabled: false },
        { type: 'separator' as const },
        { label: 'Clear Recent Files', enabled: false }
      ]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: 'About Prose',
                click: (): void => {
                  sendMenuAction('about')
                }
              },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: (): void => {
                  sendMenuAction('settings')
                }
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: (): void => {
            sendMenuAction('new')
          }
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: (): void => {
            sendMenuAction('open')
          }
        },
        {
          label: 'Open Recent',
          submenu: openRecentSubmenu
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (): void => {
            sendMenuAction('closeTab')
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (): void => {
            sendMenuAction('save')
          }
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (): void => {
            sendMenuAction('saveAs')
          }
        },
        ...(isGoogleConfigured
          ? [
              { type: 'separator' as const },
              {
                label: 'Sync with Google Docs',
                accelerator: 'CmdOrCtrl+Shift+G',
                click: (): void => {
                  sendMenuAction('googleSync')
                }
              },
              {
                label: 'Import from Google Docs...',
                accelerator: 'CmdOrCtrl+Shift+I',
                click: (): void => {
                  sendMenuAction('googleImport')
                }
              }
            ]
          : []),
        ...(isMac
          ? []
          : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: (): void => {
            sendMenuAction('undo')
          }
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
          click: (): void => {
            sendMenuAction('redo')
          }
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const }
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const }
            ]),
        { type: 'separator' },
        {
          label: 'Copy Markdown',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (): void => {
            sendMenuAction('copyMarkdown')
          }
        },
        {
          label: 'Add Comment',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: (): void => {
            sendMenuAction('addComment')
          }
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: (): void => {
            sendMenuAction('find')
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Source View',
          accelerator: 'Shift+CmdOrCtrl+E',
          click: (): void => {
            sendMenuAction('toggleSourceView')
          }
        },
        {
          label: 'Toggle File List',
          accelerator: 'Shift+CmdOrCtrl+H',
          click: (): void => {
            sendMenuAction('toggleFileList')
          }
        },
        {
          label: 'Toggle Chat Panel',
          accelerator: 'Shift+CmdOrCtrl+L',
          click: (): void => {
            sendMenuAction('toggleChat')
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'F1',
          click: (): void => {
            sendMenuAction('shortcuts')
          }
        },
        { type: 'separator' },
        {
          label: 'Learn More',
          click: async (): Promise<void> => {
            const { shell } = await import('electron')
            await shell.openExternal('https://github.com/solo-ist/prose')
          }
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'About Prose',
                click: (): void => {
                  sendMenuAction('about')
                }
              }
            ]
          : [])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * Rebuild the application menu with updated recent files.
 * Called after a file is opened or the recent files list is cleared.
 */
export function refreshMenu(): void {
  if (_menuWindow && !_menuWindow.isDestroyed()) {
    createMenu(_menuWindow)
  }
}
