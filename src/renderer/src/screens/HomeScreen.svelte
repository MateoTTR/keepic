<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import StatsPanel from '../components/StatsPanel.svelte'
  import type { AppConfig, GoogleAuthStatus, LibraryStats } from '../../../shared/types'

  interface Props {
    libraryPath: string | null
    heicMode: AppConfig['heic']['mode']
    sourceFolder: string
    googleAuthStatus: GoogleAuthStatus | null
    onLibraryPathChange: (path: string) => void
    onHeicModeChange: (mode: AppConfig['heic']['mode']) => void
    onSourceFolder: (folder: string) => void
    onAnalyse: () => void
    onGoogleImport: () => void
    onGoogleAuthChange: (status: GoogleAuthStatus) => void
    onDedupScan: () => void
    onReindex: () => void
  }

  let { libraryPath, heicMode, sourceFolder, googleAuthStatus, onLibraryPathChange, onHeicModeChange, onSourceFolder, onAnalyse, onGoogleImport, onGoogleAuthChange, onDedupScan, onReindex }: Props = $props()

  let connecting: boolean = $state(false)
  let connectError: string | null = $state(null)
  let stats: LibraryStats | null = $state(null)

  onMount(async () => {
    stats = await window.keepic.library.getStats()
  })

  async function setHeicMode(mode: AppConfig['heic']['mode']): Promise<void> {
    const updated = await window.keepic.config.setHeicConfig({ mode, jpegQuality: 90 })
    onHeicModeChange(updated.heic.mode)
  }

  async function configureLibraryFolder(): Promise<void> {
    const result = await window.keepic.config.selectLibraryFolder()
    if (!result.cancelled && result.path) {
      onLibraryPathChange(result.path)
      stats = await window.keepic.library.getStats()
    }
  }

  async function selectFolder(): Promise<void> {
    const result = await window.keepic.import.selectSourceFolder()
    if (!result.cancelled && result.path) {
      onSourceFolder(result.path)
    }
  }

  async function connectGoogle(): Promise<void> {
    connecting = true
    connectError = null
    const result = await window.keepic.google.connect()
    connecting = false
    if ('error' in result) {
      connectError = result.error
    } else {
      onGoogleAuthChange({ authenticated: true, email: result.email })
    }
  }

  async function disconnectGoogle(): Promise<void> {
    await window.keepic.google.disconnect()
    onGoogleAuthChange({ authenticated: false })
  }
</script>

<div class="space-y-6">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">KeePic</h1>
      <p class="text-gray-500 mt-1">Import photos from a local folder or SD card</p>
    </div>

    <!-- Library folder configuration -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Library folder</p>
      {#if libraryPath}
        <p class="text-sm text-gray-600 font-mono text-xs bg-gray-100 px-2 py-1 rounded break-all">{libraryPath}</p>
        <Button variant="outline" onclick={configureLibraryFolder}>Change…</Button>
        {#if stats !== null && stats.totalPhotos === 0}
          <div class="bg-amber-50 border border-amber-200 rounded p-3">
            <p class="text-sm text-amber-700">Library not indexed yet. Click <strong>Re-index library</strong> below before importing to detect existing duplicates.</p>
          </div>
        {/if}
      {:else}
        <p class="text-sm text-amber-600 font-medium">No library folder configured. Select a folder before importing photos.</p>
        <Button onclick={configureLibraryFolder}>Configure library folder…</Button>
      {/if}
    </div>

    <hr class="border-gray-200" />

    <!-- Local folder / SD card section -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Local folder / SD card</p>

      <Button onclick={selectFolder}>Select folder…</Button>

      {#if sourceFolder}
        <p class="text-sm text-gray-600">
          <span class="font-medium">Selected:</span>
          <span class="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded ml-1">{sourceFolder}</span>
        </p>
      {:else}
        <p class="text-sm text-gray-400">No folder selected</p>
      {/if}

      <Button
        onclick={onAnalyse}
        disabled={!sourceFolder}
      >
        Analyse →
      </Button>
    </div>

    <hr class="border-gray-200" />

    <!-- Google Photos section -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Google Photos</p>

      {#if googleAuthStatus?.authenticated}
        <p class="text-sm text-gray-700">
          Connected as: <span class="font-medium">{googleAuthStatus.email}</span>
        </p>
        <div class="flex gap-3">
          <Button variant="outline" onclick={disconnectGoogle}>Disconnect</Button>
          <Button onclick={onGoogleImport}>Import from Google Photos →</Button>
        </div>
      {:else}
        {#if connectError}
          <p class="text-sm text-red-600">{connectError}</p>
        {/if}
        <Button onclick={connectGoogle} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect Google Photos'}
        </Button>
      {/if}
    </div>

    <hr class="border-gray-200" />

    <!-- Library management section -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Library</p>
      <Button variant="outline" onclick={onDedupScan}>Scan for duplicates</Button>
      <Button variant="outline" onclick={onReindex}>Re-index library</Button>
    </div>

    <hr class="border-gray-200" />

    <!-- Settings section -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Settings</p>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-700">HEIC files:</span>
        <div class="inline-flex rounded-md shadow-sm" role="group">
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-l-md border {heicMode === 'keep' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
            onclick={() => setHeicMode('keep')}
          >
            Keep original
          </button>
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-r-md border border-l-0 {heicMode === 'convert' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
            onclick={() => setHeicMode('convert')}
          >
            Convert to JPEG
          </button>
        </div>
      </div>
      <p class="text-xs text-gray-400">
        {#if heicMode === 'keep'}
          HEIC photos are imported as-is. Not all viewers support this format.
        {:else}
          HEIC photos are converted to JPEG during import (quality 90%).
        {/if}
      </p>
    </div>
  </div>

  <StatsPanel {stats} />
</div>
