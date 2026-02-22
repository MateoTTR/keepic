<script lang="ts">
  import Button from '../components/ui/Button.svelte'
  import type { GoogleAuthStatus } from '../../../shared/types'

  interface Props {
    sourceFolder: string
    googleAuthStatus: GoogleAuthStatus | null
    onSourceFolder: (folder: string) => void
    onAnalyse: () => void
    onGoogleImport: () => void
    onGoogleAuthChange: (status: GoogleAuthStatus) => void
  }

  let { sourceFolder, googleAuthStatus, onSourceFolder, onAnalyse, onGoogleImport, onGoogleAuthChange }: Props = $props()

  let connecting: boolean = $state(false)
  let connectError: string | null = $state(null)

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

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-gray-900">KeePic</h1>
    <p class="text-gray-500 mt-1">Import photos from a local folder or SD card</p>
  </div>

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
</div>
