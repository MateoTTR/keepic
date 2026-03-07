<script lang="ts">
  import type { ImportResult, SkippedFile } from '../../../shared/types'
  import Button from '../components/ui/Button.svelte'
  import Separator from '../components/ui/Separator.svelte'
  import { formatElapsed } from '../utils'

  interface Props {
    result: ImportResult | null
    elapsedMs: number
    onImportMore: () => void
    onDone: () => void
  }

  let { result, elapsedMs, onImportMore, onDone }: Props = $props()

  const statusLabel = $derived(() => {
    if (!result) return 'Import complete'
    if (result.status === 'completed') return 'Import complete ✓'
    if (result.status === 'cancelled') return 'Import cancelled'
    return 'Import failed'
  })

  const statusClass = $derived(() => {
    if (!result) return 'text-gray-900'
    if (result.status === 'completed') return 'text-green-700'
    if (result.status === 'cancelled') return 'text-amber-700'
    return 'text-red-700'
  })

  const skippedFiles = $derived(result?.skippedFiles ?? [])
  const livePhotoSkipped = $derived(skippedFiles.filter((f: SkippedFile) => f.reason === 'live-photo'))
  const unrecognizedSkipped = $derived(skippedFiles.filter((f: SkippedFile) => f.reason === 'unrecognized-extension'))
  const errorSkipped = $derived(skippedFiles.filter((f: SkippedFile) => f.reason === 'error'))

  function displayPath(fullPath: string): string {
    return fullPath.split(/[/\\]/).slice(-2).join('/')
  }
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <h2 class="text-xl font-semibold {statusClass()}">
    {statusLabel()}
    {#if elapsedMs > 0}
      <span class="text-sm font-normal text-gray-400 ml-2">in {formatElapsed(elapsedMs)}</span>
    {/if}
  </h2>

  {#if result}
    <div class="space-y-1 text-sm text-gray-700">
      <p><span class="font-medium w-6 inline-block text-right mr-3">{result.imported}</span> photo{result.imported !== 1 ? 's' : ''} imported</p>
      <p><span class="font-medium w-6 inline-block text-right mr-3">{result.skipped}</span> duplicate{result.skipped !== 1 ? 's' : ''} skipped</p>
      {#if result.livePhotosDiscarded > 0}
        <p><span class="font-medium w-6 inline-block text-right mr-3">{result.livePhotosDiscarded}</span> Live Photo video{result.livePhotosDiscarded !== 1 ? 's' : ''} discarded</p>
      {/if}
    </div>

    {#if result.errors.length > 0}
      <div class="space-y-2">
        <Separator />
        <h3 class="text-sm font-medium text-red-700">Errors ({result.errors.length}):</h3>
        <ul class="space-y-1">
          {#each result.errors as err, i (i)}
            <li class="text-xs text-red-600">
              • <span class="font-mono">{err.sourcePath.split(/[/\\]/).pop()}</span>
              — {err.error}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if skippedFiles.length > 0}
      <div class="space-y-2">
        <Separator />
        <details>
          <summary class="text-sm font-medium text-gray-600 cursor-pointer select-none">
            Skipped files ({skippedFiles.length})
          </summary>
          <div class="mt-2 space-y-3 text-xs">
            {#if livePhotoSkipped.length > 0}
              <div>
                <p class="font-medium text-gray-500 mb-1">Live Photo videos ({livePhotoSkipped.length})</p>
                <ul class="space-y-0.5 text-gray-500">
                  {#each livePhotoSkipped as f, i (i)}
                    <li class="font-mono">• {displayPath(f.path)}</li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if unrecognizedSkipped.length > 0}
              <div>
                <p class="font-medium text-gray-500 mb-1">Unrecognized extensions ({unrecognizedSkipped.length})</p>
                <ul class="space-y-0.5 text-gray-500">
                  {#each unrecognizedSkipped as f, i (i)}
                    <li class="font-mono">• {displayPath(f.path)}{#if f.extension} <span class="text-gray-400">({f.extension})</span>{/if}</li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if errorSkipped.length > 0}
              <div>
                <p class="font-medium text-red-500 mb-1">Errors ({errorSkipped.length})</p>
                <ul class="space-y-0.5 text-red-400">
                  {#each errorSkipped as f, i (i)}
                    <li class="font-mono">• {displayPath(f.path)}</li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </details>
      </div>
    {/if}
  {/if}

  <div class="flex gap-3 pt-2">
    <Button variant="outline" onclick={onImportMore}>Import more</Button>
    <Button onclick={onDone}>Done</Button>
  </div>
</div>
