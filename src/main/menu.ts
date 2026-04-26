import { Menu, BrowserWindow, app, shell } from 'electron'
import { basename } from 'path'
import { is } from '@electron-toolkit/utils'
import { loadRecentFiles, clearRecentFiles } from './recentFiles'
import { IS_MAS_BUILD } from './env'

// Store mainWindow reference so we can rebuild the menu after adding recent files
let _menuWindow: BrowserWindow | null = null

// Helper to open an external URL without leaking an unhandled promise
// rejection if the OS can't open the URL (e.g., no default browser).
function openExternalUrl(url: string): void {
  shell.openExternal(url).catch((err) => {
    console.warn('[Menu] Failed to open external URL:', url, err)
  })
}

// Helper to safely send menu actions to the focused window.
// Falls back to _menuWindow when no window is focused (window hidden via
// hide-on-close or minimized) — otherwise menu items would silently no-op,
// which Apple cited in MAS rejection of build 20 (see issue #429).
function sendMenuAction(action: string): void {
  let win = BrowserWindow.getFocusedWindow()
  if (!win || win.isDestroyed()) {
    if (_menuWindow && !_menuWindow.isDestroyed()) {
      if (_menuWindow.isMinimized()) _menuWindow.restore()
      _menuWindow.show()
      _menuWindow.focus()
      win = _menuWindow
    } else {
      return
    }
  }
  win.webContents.send('menu:action', action)
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
          label: 'New Document',
          accelerator: 'CmdOrCtrl+N',
          click: (): void => {
            sendMenuAction('new')
          }
        },
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
        {
          label: 'Convert to Plain Text',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (): void => {
            sendMenuAction('convertToTxt')
          }
        },
        {
          label: 'Convert to Markdown',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: (): void => {
            sendMenuAction('convertToMarkdown')
          }
        },
        ...(!IS_MAS_BUILD && isGoogleConfigured
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
        ...(is.dev || process.env.PROSE_DEBUG === '1' ? [
          { role: 'reload' as const },
          { role: 'forceReload' as const },
          { role: 'toggleDevTools' as const },
          { type: 'separator' as const },
        ] : []),
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
              {
                label: 'Prose',
                click: (): void => {
                  if (_menuWindow && !_menuWindow.isDestroyed()) {
                    if (_menuWindow.isMinimized()) _menuWindow.restore()
                    _menuWindow.show()
                    _menuWindow.focus()
                  }
                }
              },
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
          click: (): void => {
            openExternalUrl('https://github.com/solo-ist/prose')
          }
        },
        ...(!IS_MAS_BUILD
          ? [
              {
                label: 'Download Prose Skill for Claude',
                click: (): void => {
                  sendMenuAction('downloadSkill')
                }
              }
            ]
          : []),
        { type: 'separator' },
        ...(IS_MAS_BUILD
          ? [
              {
                label: 'Request Support',
                click: (): void => {
                  openExternalUrl('https://solo.ist/prose/support')
                }
              }
            ]
          : [
              {
                label: 'Report a Bug',
                click: (): void => {
                  openExternalUrl('https://github.com/solo-ist/prose/issues/new?template=bug-report.yml')
                }
              }
            ]),
        {
          label: 'Request a Feature',
          click: (): void => {
            openExternalUrl('https://github.com/solo-ist/prose/issues/new?template=feature-request.yml')
          }
        },
        {
          label: 'Discuss Ideas',
          click: (): void => {
            openExternalUrl('https://github.com/solo-ist/prose/discussions/categories/ideas')
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
