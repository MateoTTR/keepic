<script lang="ts">
  import { onMount } from 'svelte'
  import type { SkippedFile } from '../../../shared/types'
  import Button from '../components/ui/Button.svelte'
  import { formatElapsed } from '../utils'

  interface Props {
    onBack: () => void
  }

  let { onBack }: Props = $props()

  type Status = 'starting' | 'running' | 'done' | 'error' | 'alreadyRunning'

  let status: Status = $state('starting')
  let progress: { processed: number; total: number } | null = $state(null)
  let result: {
    indexed: number
    indexedPhotos: number
    indexedVideos: number
    skipped: number
    deleted: number
  } | null = $state(null)
  let skippedFiles: SkippedFile[] = $state([])
  let errorMessage: string | null = $state(null)
  let startTime: number = $state(0)
  let elapsedMs: number = $state(0)

  const done = $derived(status === 'done' || status === 'error' || status === 'alreadyRunning')

  const livePhotoSkipped = $derived(skippedFiles.filter((f) => f.reason === 'live-photo'))
  const unrecognizedSkipped = $derived(skippedFiles.filter((f) => f.reason === 'unrecognized-extension'))
  const errorSkipped = $derived(skippedFiles.filter((f) => f.reason === 'error'))

  onMount(async () => {
    startTime = Date.now()

    window.keepic.library.onIndexProgress((p) => {
      status = 'running'
      progress = { processed: p.processed, total: p.total }
    })

    window.keepic.library.onIndexComplete((r) => {
      elapsedMs = Date.now() - startTime
      if (r.type === 'complete') {
        result = {
          indexed: r.indexed ?? 0,
          indexedPhotos: r.indexedPhotos ?? 0,
          indexedVideos: r.indexedVideos ?? 0,
          skipped: r.skipped ?? 0,
          deleted: r.deleted ?? 0
        }
        skippedFiles = r.skippedFiles ?? []
        status = 'done'
      } else {
        errorMessage = r.message ?? 'Unknown error'
        status = 'error'
      }
    })

    const reply = await window.keepic.library.startIndex()
    if ('alreadyRunning' in reply) {
      status = 'alreadyRunning'
    } else if ('error' in reply) {
      errorMessage = reply.error ?? 'Unknown error'
      status = 'error'
    }
    // { started: true } → wait for push events
  })
</script>

<div class="space-y-6">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">Re-index Library</h1>
      <Button variant="outline" onclick={onBack} disabled={!done}>← Back</Button>
    </div>

    {#if status === 'starting'}
      <p class="text-gray-500">Starting…</p>
    {:else if status === 'running'}
      <p class="text-gray-700">
        Scanning…
        {#if progress}
          {progress.processed} / {progress.total} files
        {/if}
      </p>
    {:else if status === 'done' && result}
      <p class="text-gray-700">
        ✓ Done in {formatElapsed(elapsedMs)} — {result.indexed} indexed{#if result.indexedPhotos > 0 || result.indexedVideos > 0} ({result.indexedPhotos} photos, {result.indexedVideos} videos){/if}, {result.skipped} unchanged, {result.deleted} removed
      </p>

      {#if skippedFiles.length > 0}
        <details class="mt-2">
          <summary class="text-sm font-medium text-gray-600 cursor-pointer select-none">
            Skipped files ({skippedFiles.length})
          </summary>
          <div class="mt-2 space-y-3 text-xs">
            {#if livePhotoSkipped.length > 0}
              <div>
                <p class="font-medium text-gray-500 mb-1">Live Photo videos ({livePhotoSkipped.length})</p>
                <ul class="space-y-0.5 text-gray-500">
                  {#each livePhotoSkipped as f, i (i)}
                    <li class="font-mono">• {f.path}</li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if unrecognizedSkipped.length > 0}
              <div>
                <p class="font-medium text-gray-500 mb-1">Unrecognized extensions ({unrecognizedSkipped.length})</p>
                <ul class="space-y-0.5 text-gray-500">
                  {#each unrecognizedSkipped as f, i (i)}
                    <li class="font-mono">• {f.path}{#if f.extension} <span class="text-gray-400">({f.extension})</span>{/if}</li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if errorSkipped.length > 0}
              <div>
                <p class="font-medium text-red-500 mb-1">Errors ({errorSkipped.length})</p>
                <ul class="space-y-0.5 text-red-400">
                  {#each errorSkipped as f, i (i)}
                    <li class="font-mono">• {f.path}</li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </details>
      {/if}
    {:else if status === 'alreadyRunning'}
      <p class="text-gray-500">A re-index is already in progress.</p>
    {:else if status === 'error'}
      <p class="text-red-600">✗ Error: {errorMessage}</p>
    {/if}
  </div>
</div>
