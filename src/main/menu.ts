import { Menu, BrowserWindow, app } from 'electron'
import { getRecentFiles } from './ipc'

let mainWindowRef: BrowserWindow | null = null

// Rebuild menu with updated recent files
export async function rebuildMenu(): Promise<void> {
  if (mainWindowRef) {
    await createMenu(mainWindowRef)
  }
}

export async function createMenu(mainWindow: BrowserWindow): Promise<void> {
  mainWindowRef = mainWindow
  const isMac = process.platform === 'darwin'
  const recentFiles = await getRecentFiles()

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: (): void => {
                  mainWindow.webContents.send('menu:action', 'settings')
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
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: (): void => {
            mainWindow.webContents.send('menu:action', 'new')
          }
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: (): void => {
            mainWindow.webContents.send('menu:action', 'open')
          }
        },
        {
          label: 'Open Recent',
          submenu: recentFiles.length === 0
            ? [{ label: 'No Recent Files', enabled: false }]
            : [
                ...recentFiles.map((file) => ({
                  label: file.name,
                  click: (): void => {
                    mainWindow.webContents.send('menu:action', `openRecent:${file.path}`)
                  }
                })),
                { type: 'separator' as const },
                {
                  label: 'Clear Recent',
                  click: (): void => {
                    mainWindow.webContents.send('menu:action', 'clearRecent')
                  }
                }
              ]
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (): void => {
            mainWindow.webContents.send('menu:action', 'save')
          }
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (): void => {
            mainWindow.webContents.send('menu:action', 'saveAs')
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
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
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: (): void => {
            mainWindow.webContents.send('menu:action', 'find')
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
          label: 'Toggle Chat Panel',
          accelerator: 'CmdOrCtrl+\\',
          click: (): void => {
            mainWindow.webContents.send('menu:action', 'toggleChat')
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
            mainWindow.webContents.send('menu:action', 'shortcuts')
          }
        },
        { type: 'separator' },
        {
          label: 'Learn More',
          click: async (): Promise<void> => {
            const { shell } = await import('electron')
            await shell.openExternal('https://github.com/prose-editor/prose')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
