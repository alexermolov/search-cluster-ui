import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc'
import { ConnectionStore } from './store/connections'

// Set by scripts/dev.mjs when running against the Vite dev server.
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // The app opens no external windows; everything renders in-app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (DEV_RENDERER_URL) {
    void win.loadURL(DEV_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerIpcHandlers(new ConnectionStore())

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
