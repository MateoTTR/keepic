import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ConfigManager } from './config'
import { KeePicDatabase } from './db/database'
import { handleGetConfig, handleSelectLibraryFolder } from './ipc/config-handlers'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
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
}

app.whenReady().then(() => {
  const configManager = new ConfigManager(app.getPath('userData'))
  configManager.load()

  // Open the database if a library path is already configured.
  let database: KeePicDatabase | null = null
  if (configManager.get().libraryPath) {
    database = new KeePicDatabase(join(app.getPath('userData'), 'index.db'))
    database.open()
  }

  ipcMain.handle('config:get', () => handleGetConfig(configManager))

  ipcMain.handle('config:select-library-folder', async () => {
    const result = await handleSelectLibraryFolder(
      dialog.showOpenDialog.bind(dialog),
      configManager
    )

    // If a valid library path was selected for the first time, open the database.
    if (!result.cancelled && result.path && !database) {
      database = new KeePicDatabase(join(app.getPath('userData'), 'index.db'))
      database.open()
    }

    return result
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
