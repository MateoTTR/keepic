<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ImportPlan, ImportProgress, ImportResult } from '../../../shared/types'
  import Button from '../components/ui/Button.svelte'
  import Progress from '../components/ui/Progress.svelte'

  interface Props {
    plan: ImportPlan
    onProgress: (p: ImportProgress) => void
    onComplete: (r: ImportResult) => void
  }

  let { plan, onProgress, onComplete }: Props = $props()

  let progress: ImportProgress | null = $state(null)
  let cancelling: boolean = $state(false)

  onMount(async () => {
    window.keepic.import.onProgress((p) => {
      progress = p
      onProgress(p)
    })
    window.keepic.import.onComplete((r) => {
      onComplete(r)
    })

    const result = await window.keepic.import.execute($state.snapshot(plan)).catch((err: Error) => ({
      error: err.message
    }))
    if ('alreadyRunning' in result || 'error' in result) {
      const msg = 'error' in result ? result.error : 'An import is already in progress.'
      onComplete({
        imported: 0,
        skipped: 0,
        livePhotosDiscarded: plan.livePhotosDiscarded,
        errors: [{ sourcePath: '', error: msg }],
        status: 'failed'
      })
    }
  })

  onDestroy(() => {
    window.keepic.import.removeProgressListeners()
    window.keepic.import.removeCompleteListeners()
  })

  async function cancel(): Promise<void> {
    cancelling = true
    const result = await window.keepic.import.cancel()
    if ('noWorker' in result && result.noWorker) {
      onComplete({
        imported: 0,
        skipped: 0,
        livePhotosDiscarded: plan.livePhotosDiscarded,
        errors: [],
        status: 'cancelled'
      })
    }
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
