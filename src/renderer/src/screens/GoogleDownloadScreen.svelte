<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import type { GoogleDownloadProgress, GoogleDownloadResult } from '../../../shared/types'

  interface Props {
    onDownloadComplete: (result: GoogleDownloadResult) => void
    onBack: () => void
  }

  let { onDownloadComplete, onBack }: Props = $props()

  type State = 'date-select' | 'downloading' | 'complete' | 'error'

  let state: State = $state('date-select')
  let startDate: string = $state('')
  let progress: GoogleDownloadProgress | null = $state(null)
  let result: GoogleDownloadResult | null = $state(null)
  let errorMessage: string | null = $state(null)

  // Default date: one year ago (today − 365 days), computed without Date mutation
  const defaultDate = (): string =>
    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  onMount(async () => {
    // Pre-fill with last download date (or one year ago)
    const { date } = await window.keepic.google.getLastDownloadDate()
    startDate = date ?? defaultDate()

    window.keepic.google.onDownloadProgress((p) => {
      progress = p
    })

    window.keepic.google.onDownloadComplete((r) => {
      result = r
      if (r.status === 'completed' || r.status === 'cancelled') {
        state = 'complete'
      } else {
        errorMessage = r.errors[0]?.error ?? 'Download failed'
        state = 'error'
      }
    })
  })

  async function startDownload(): Promise<void> {
    state = 'downloading'
    progress = null

    const response = await window.keepic.google.startDownload(startDate)

    if ('error' in response) {
      errorMessage = response.error
      state = 'error'
    }
  }

  async function cancel(): Promise<void> {
    await window.keepic.google.cancelDownload()
  }

  function analyse(): void {
    if (result) onDownloadComplete(result)
  }
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  {#if state === 'date-select'}
    <div>
      <h2 class="text-xl font-semibold text-gray-900">Import from Google Photos</h2>
      <p class="text-sm text-gray-500 mt-1">Download photos created since the selected date.</p>
    </div>

    <div class="space-y-2">
      <label for="start-date" class="block text-sm font-medium text-gray-700">
        Import photos created since:
      </label>
      <input
        id="start-date"
        type="date"
        bind:value={startDate}
        class="block w-48 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm
               focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>

    <div class="flex gap-3">
      <Button variant="outline" onclick={onBack}>← Back</Button>
      <Button onclick={startDownload} disabled={!startDate}>Download →</Button>
    </div>

  {:else if state === 'downloading'}
    <div>
      <h2 class="text-xl font-semibold text-gray-900">Downloading from Google Photos…</h2>
      <p class="text-sm text-gray-500 mt-1">Photos are being downloaded to a local folder.</p>
    </div>

    <div class="space-y-2">
      <div class="flex gap-4 text-sm text-gray-700">
        <span><span class="font-medium">{progress?.fetched ?? 0}</span> found</span>
        <span><span class="font-medium">{progress?.downloaded ?? 0}</span> downloaded</span>
      </div>
      {#if progress?.currentFile}
        <p class="font-mono text-xs text-gray-400 truncate">{progress.currentFile}</p>
      {/if}
    </div>

    <Button variant="outline" onclick={cancel}>Cancel</Button>

  {:else if state === 'complete'}
    <div>
      <h2 class="text-xl font-semibold text-gray-900">
        {result?.status === 'cancelled' ? 'Download cancelled' : 'Download complete'}
      </h2>
    </div>

    <div class="space-y-1 text-sm text-gray-700">
      <p><span class="font-medium">{result?.downloaded ?? 0}</span> photos downloaded</p>
      {#if result?.errors && result.errors.length > 0}
        <p class="text-amber-600">
          <span class="font-medium">{result.errors.length}</span> errors
        </p>
      {/if}
    </div>

    <div class="flex gap-3">
      <Button variant="outline" onclick={onBack}>← Back</Button>
      {#if result?.downloaded && result.downloaded > 0}
        <Button onclick={analyse}>Analyse →</Button>
      {/if}
    </div>

  {:else}
    <!-- error state -->
    <div>
      <h2 class="text-xl font-semibold text-gray-900">Download failed</h2>
    </div>

    <div class="rounded-md bg-red-50 border border-red-200 p-4">
      <p class="text-sm text-red-700">{errorMessage}</p>
    </div>

    <Button variant="outline" onclick={onBack}>← Back</Button>
  {/if}
</div>
