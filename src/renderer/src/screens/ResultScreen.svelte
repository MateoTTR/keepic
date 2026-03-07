<script lang="ts">
  import type { ImportResult } from '../../../shared/types'
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
  {/if}

  <div class="flex gap-3 pt-2">
    <Button variant="outline" onclick={onImportMore}>Import more</Button>
    <Button onclick={onDone}>Done</Button>
  </div>
</div>
