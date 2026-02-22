<script lang="ts">
  import { onMount } from 'svelte'
  import type { ImportProgress, ImportResult } from '../../../shared/types'
  import Button from '../components/ui/Button.svelte'
  import Progress from '../components/ui/Progress.svelte'

  interface Props {
    onProgress: (p: ImportProgress) => void
    onComplete: (r: ImportResult) => void
  }

  let { onProgress, onComplete }: Props = $props()

  let progress: ImportProgress | null = $state(null)
  let cancelling: boolean = $state(false)

  onMount(() => {
    window.keepic.import.onProgress((p) => {
      progress = p
      onProgress(p)
    })
    window.keepic.import.onComplete((r) => {
      onComplete(r)
    })
  })

  async function cancel(): Promise<void> {
    cancelling = true
    await window.keepic.import.cancel()
  }
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-gray-900">
      {cancelling ? 'Cancelling…' : 'Importing…'}
    </h2>
  </div>

  <div class="space-y-2">
    <Progress
      value={progress?.processed ?? 0}
      max={progress?.total ?? 1}
    />
    <div class="flex justify-between text-sm text-gray-500">
      <span>
        {#if progress}
          {progress.processed} / {progress.total}
        {:else}
          Starting…
        {/if}
      </span>
    </div>
  </div>

  {#if progress}
    <div class="text-sm text-gray-600 space-y-1">
      <p>Imported: <span class="font-medium">{progress.imported}</span></p>
      <p>Skipped: <span class="font-medium">{progress.skipped}</span></p>
      {#if progress.currentFile}
        <p class="font-mono text-xs text-gray-400 truncate">Current: {progress.currentFile}</p>
      {/if}
    </div>
  {/if}

  <div>
    <Button variant="outline" disabled={cancelling} onclick={cancel}>
      {cancelling ? 'Cancelling…' : 'Cancel'}
    </Button>
  </div>
</div>
