<script lang="ts">
  import { onDestroy } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import Progress from '../components/ui/Progress.svelte'
  import type { GoogleDownloadProgress, GoogleDownloadResult } from '../../../shared/types'

  interface Props {
    onDownloadComplete: (result: GoogleDownloadResult) => void
    onBack: () => void
  }

  let { onDownloadComplete, onBack }: Props = $props()

  type PickerState = 'idle' | 'waiting' | 'downloading' | 'complete' | 'error'

  let state: PickerState = $state('idle')
  let errorMessage: string | null = $state(null)
  let pickerUri: string | null = $state(null)
  let sessionId: string | null = $state(null)
  let progress: GoogleDownloadProgress | null = $state(null)
  let downloadResult: GoogleDownloadResult | null = $state(null)
  let pollCount = 0

  const POLL_INTERVAL_MS = 3000
  const POLL_MAX = 100 // 100 × 3s ≈ 5 minutes

  let pollingTimer: ReturnType<typeof setTimeout> | null = null

  function clearPolling(): void {
    if (pollingTimer !== null) {
      clearTimeout(pollingTimer)
      pollingTimer = null
    }
  }

  async function startPickerSession(): Promise<void> {
    state = 'waiting'
    errorMessage = null
    pollCount = 0

    const result = await window.keepic.google.createPickerSession()
    if ('error' in result) {
      state = 'error'
      errorMessage = result.error
      return
    }

    pickerUri = result.pickerUri
    sessionId = result.sessionId
    window.open(pickerUri)
    schedulePoll()
  }

  function schedulePoll(): void {
    pollingTimer = setTimeout(() => void doPoll(), POLL_INTERVAL_MS)
  }

  async function doPoll(): Promise<void> {
    if (!sessionId) return

    pollCount++
    if (pollCount >= POLL_MAX) {
      clearPolling()
      state = 'error'
      errorMessage = 'No selection detected after 5 minutes. Please try again.'
      return
    }

    const result = await window.keepic.google.pollPickerSession(sessionId)
    if ('error' in result) {
      clearPolling()
      state = 'error'
      errorMessage = result.error
      return
    }

    if (result.ready) {
      clearPolling()
      await startDownload()
    } else {
      schedulePoll()
    }
  }

  async function startDownload(): Promise<void> {
    if (!sessionId) return

    state = 'downloading'

    window.keepic.google.onPickerDownloadProgress((p) => {
      progress = p
    })

    window.keepic.google.onPickerDownloadComplete((r) => {
      window.keepic.google.removePickerDownloadListeners()
      if (r.status === 'completed') {
        downloadResult = r
        state = 'complete'
      } else if (r.status === 'cancelled') {
        progress = null
        state = 'idle'
      } else {
        errorMessage = r.errors.length > 0 ? r.errors[0].error : 'Download failed.'
        state = 'error'
      }
    })

    const result = await window.keepic.google.startPickerDownload(sessionId)
    if ('error' in result || 'alreadyRunning' in result) {
      window.keepic.google.removePickerDownloadListeners()
      errorMessage = 'error' in result ? result.error : 'A download is already in progress.'
      state = 'error'
    }
  }

  async function cancelDownload(): Promise<void> {
    await window.keepic.google.cancelPickerDownload()
    // state transitions happen via onPickerDownloadComplete callback
  }

  function handleAnalyse(): void {
    if (downloadResult) {
      onDownloadComplete(downloadResult)
    }
  }

  function handleBack(): void {
    clearPolling()
    window.keepic.google.removePickerDownloadListeners()
    if (state === 'downloading') {
      void window.keepic.google.cancelPickerDownload()
    }
    onBack()
  }

  function handleRetry(): void {
    clearPolling()
    window.keepic.google.removePickerDownloadListeners()
    state = 'idle'
    errorMessage = null
    pickerUri = null
    sessionId = null
    progress = null
    downloadResult = null
    pollCount = 0
  }

  onDestroy(() => {
    clearPolling()
    window.keepic.google.removePickerDownloadListeners()
  })
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-gray-900">Import from Google Photos</h2>
  </div>

  {#if state === 'idle'}
    <p class="text-sm text-gray-500">
      Select photos from your Google Photos library using Google's secure photo picker.
      You can browse and select photos by day directly in your browser.
    </p>
    <div class="flex gap-3">
      <Button onclick={startPickerSession}>Open Google Photos Picker →</Button>
      <Button variant="outline" onclick={handleBack}>← Back</Button>
    </div>

  {:else if state === 'waiting'}
    <div class="space-y-4">
      <div class="flex items-center gap-3">
        <div class="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent flex-shrink-0"></div>
        <p class="text-sm font-medium text-gray-700">Waiting for your selection…</p>
      </div>

      <div class="rounded-md bg-blue-50 border border-blue-200 p-4">
        <p class="text-sm text-blue-800 font-medium mb-2">In the Google Photos tab that just opened:</p>
        <ol class="list-decimal list-inside text-sm text-blue-700 space-y-1">
          <li>Browse and select the photos you want to import (you can select by day).</li>
          <li>Click <strong>Done</strong> to confirm your selection.</li>
          <li>KeePic will automatically detect your selection and start downloading.</li>
        </ol>
      </div>

      {#if pickerUri}
        <Button variant="outline" onclick={() => window.open(pickerUri!)}>Re-open Google Photos Picker</Button>
      {/if}

      <Button variant="outline" onclick={handleBack}>← Cancel</Button>
    </div>

  {:else if state === 'downloading'}
    <div class="space-y-4">
      <p class="text-sm text-gray-600">Downloading selected photos…</p>

      <Progress value={progress?.downloaded ?? 0} max={progress?.total ?? 1} />

      <div class="text-sm text-gray-500">
        {#if progress}
          {progress.downloaded} / {progress.total} photos
        {:else}
          Starting…
        {/if}
      </div>

      {#if progress?.currentFile}
        <p class="font-mono text-xs text-gray-400 truncate">Current: {progress.currentFile}</p>
      {/if}

      <Button variant="outline" onclick={cancelDownload}>Cancel</Button>
    </div>

  {:else if state === 'complete'}
    <div class="space-y-4">
      <div class="rounded-md bg-green-50 border border-green-200 p-4">
        <p class="text-sm text-green-800 font-medium">
          {downloadResult!.downloaded} photo{downloadResult!.downloaded !== 1 ? 's' : ''} downloaded successfully.
        </p>
      </div>

      {#if downloadResult!.errors.length > 0}
        <div class="rounded-md bg-amber-50 border border-amber-200 p-4">
          <p class="text-sm text-amber-800 font-medium mb-2">
            {downloadResult!.errors.length} file{downloadResult!.errors.length !== 1 ? 's' : ''} could not be downloaded:
          </p>
          <ul class="list-disc list-inside text-sm text-amber-700 space-y-1">
            {#each downloadResult!.errors as err}
              <li class="font-mono text-xs truncate">{err.filename}: {err.error}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="flex gap-3">
        <Button onclick={handleAnalyse} disabled={downloadResult!.downloaded === 0}>Analyse →</Button>
        <Button variant="outline" onclick={handleBack}>← Back</Button>
      </div>
    </div>

  {:else if state === 'error'}
    <div class="rounded-md bg-red-50 border border-red-200 p-4">
      <p class="text-sm text-red-800">{errorMessage}</p>
    </div>
    <div class="flex gap-3">
      <Button onclick={handleRetry}>Try again</Button>
      <Button variant="outline" onclick={handleBack}>← Back</Button>
    </div>
  {/if}
</div>
