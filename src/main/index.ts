import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { is } from '@electron-toolkit/utils'
import { ConfigManager } from './config'
import { KeePicDatabase } from './db/database'
import { createProtocolHandler } from './protocol'
import {
  handleGetConfig,
  handleSelectLibraryFolder,
  handleSetHeicConfig
} from './ipc/config-handlers'
import {
  handleSelectSourceFolder,
  handlePlan,
  handleExecute,
  handleCancel,
  type ActiveWorkerRef
} from './ipc/import-handlers'
import { handleGetAuthStatus, handleConnect, handleDisconnect } from './ipc/google-auth-handlers'
import { handleGetLibraryStats } from './ipc/library-stats-handler'
import { handleScanDuplicates } from './ipc/dedup-scan-handler'
import {
  handleGetLastDownloadDate,
  handleCleanupDownloadDir,
  handleCreatePickerSession,
  handlePollPickerSession,
  handleStartPickerDownload,
  handleCancelPickerDownload,
  type ActivePickerWorkerRef
} from './ipc/google-photos-handlers'
import { handleRevealInFolder, handleRevealLibraryFile } from './ipc/shell-handlers'
import type { AppConfig, ImportPlan } from '../shared/types'

/* v8 ignore next 3 -- must run before app.ready, cannot be tested in Vitest */
protocol.registerSchemesAsPrivileged([
  { scheme: 'keepic-photo', privileges: { supportFetchAPI: true } }
])

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

  // Register custom protocol for serving photo thumbnails to the renderer.
  const protocolHandler = createProtocolHandler(() => configManager.get().libraryPath)
  protocol.handle('keepic-photo', protocolHandler)

  // Open the database if a library path is already configured.
  let database: KeePicDatabase | null = null
  if (configManager.get().libraryPath) {
    database = new KeePicDatabase(join(app.getPath('userData'), 'index.db'))
    database.open()
  }

  // Track the running indexer worker to prevent concurrent runs.
  let indexerWorker: Worker | null = null

  // Track the running importer worker (Phase 2) to prevent concurrent imports.
  const importerWorkerRef: ActiveWorkerRef = { value: null }

  // Track the running Picker download worker.
  const pickerWorkerRef: ActivePickerWorkerRef = { value: null }

  const plannerWorkerPath = join(__dirname, 'workers/planner.worker.js')
  const importerWorkerPath = join(__dirname, 'workers/importer.worker.js')
  const pickerWorkerPath = join(__dirname, 'workers/google-photos-picker.worker.js')
  const dbPath = join(app.getPath('userData'), 'index.db')

  // --- Config IPC ---

  ipcMain.handle('config:get', () => handleGetConfig(configManager))

  ipcMain.handle('config:set-heic-config', (_event, { heic }: { heic: AppConfig['heic'] }) =>
    handleSetHeicConfig(configManager, heic)
  )

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

  // --- Import IPC ---

  ipcMain.handle('import:select-source-folder', () =>
    handleSelectSourceFolder(dialog.showOpenDialog.bind(dialog))
  )

  ipcMain.handle('import:plan', async (event, { sourcePath }: { sourcePath: string }) => {
    const libraryPath = configManager.get().libraryPath
    if (!libraryPath) return { error: 'No library path configured' }
    if (!database) return { error: 'Database not open' }

    return handlePlan(
      sourcePath,
      libraryPath,
      dbPath,
      configManager.get(),
      (progress) => event.sender.send('import:plan-progress', progress),
      plannerWorkerPath
    )
  })

  ipcMain.handle('import:execute', (event, { plan }: { plan: ImportPlan }) => {
    const libraryPath = configManager.get().libraryPath
    if (!libraryPath) return { error: 'No library path configured' }
    if (!database) return { error: 'Database not open' }

    return handleExecute(
      plan,
      libraryPath,
      dbPath,
      app.getPath('userData'),
      configManager.get(),
      (progress) => event.sender.send('import:progress', progress),
      (result) => event.sender.send('import:complete', result),
      importerWorkerRef,
      importerWorkerPath
    )
  })

  ipcMain.handle('import:cancel', () => handleCancel(importerWorkerRef))

  // --- Google Auth IPC ---

  ipcMain.handle('google:get-auth-status', () => handleGetAuthStatus())
  ipcMain.handle('google:connect', () => handleConnect())
  ipcMain.handle('google:disconnect', () => handleDisconnect())

  // --- Google Photos IPC ---

  ipcMain.handle('google:get-last-download-date', () => {
    if (!database) return { date: null }
    return handleGetLastDownloadDate(database)
  })

  ipcMain.handle('google:cleanup-download-dir', (_event, { dirPath }: { dirPath: string }) =>
    handleCleanupDownloadDir(dirPath)
  )

  ipcMain.handle('google:create-picker-session', () => handleCreatePickerSession())

  ipcMain.handle('google:poll-picker-session', (_event, { sessionId }: { sessionId: string }) =>
    handlePollPickerSession(sessionId)
  )

  ipcMain.handle('google:start-picker-download', (event, { sessionId }: { sessionId: string }) => {
    const downloadDir = join(app.getPath('userData'), 'picker-staging', `${Date.now()}`)
    return handleStartPickerDownload(
      sessionId,
      downloadDir,
      (progress) => event.sender.send('google:picker-download-progress', progress),
      (result) => event.sender.send('google:picker-download-complete', result),
      pickerWorkerRef,
      pickerWorkerPath
    )
  })

  ipcMain.handle('google:cancel-picker-download', () => handleCancelPickerDownload(pickerWorkerRef))

  // --- Library stats IPC ---

  ipcMain.handle('library:get-stats', () => {
    if (!database) return null
    return handleGetLibraryStats(database)
  })

  ipcMain.handle('library:scan-duplicates', () => {
    if (!database) return []
    return handleScanDuplicates(database)
  })

  // --- Shell IPC ---

  ipcMain.handle('shell:reveal-in-folder', (_event, { absolutePath }: { absolutePath: string }) =>
    handleRevealInFolder(absolutePath, shell.showItemInFolder.bind(shell))
  )

  ipcMain.handle(
    'shell:reveal-library-file',
    (_event, { relativePath }: { relativePath: string }) =>
      handleRevealLibraryFile(
        relativePath,
        configManager.get().libraryPath,
        shell.showItemInFolder.bind(shell)
      )
  )

  // --- Library indexer IPC ---

  ipcMain.handle('library:start-index', (event) => {
    if (indexerWorker) {
      return { alreadyRunning: true }
    }

    const libraryPath = configManager.get().libraryPath
    if (!libraryPath) {
      return { error: 'No library path configured' }
    }

    const indexerWorkerPath = join(__dirname, 'workers/indexer.worker.js')

    indexerWorker = new Worker(indexerWorkerPath, {
      workerData: { libraryPath, dbPath }
    })

    indexerWorker.on('message', (msg: { type: string }) => {
      if (msg.type === 'progress') {
        event.sender.send('library:index-progress', msg)
      } else if (msg.type === 'complete' || msg.type === 'error') {
        event.sender.send('library:index-complete', msg)
        indexerWorker = null
      }
    })

    indexerWorker.on('error', (err: Error) => {
      event.sender.send('library:index-complete', { type: 'error', message: err.message })
      indexerWorker = null
    })

    return { started: true }
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
