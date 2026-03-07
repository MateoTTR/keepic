<script lang="ts">
  import { onMount } from 'svelte'
  import type { ImportPlanEntry, PlanProgress, SkippedFile } from '../../../shared/types'
  import Progress from '../components/ui/Progress.svelte'

  interface Props {
    sourceFolder: string
    onProgress: (p: PlanProgress) => void
    onSuccess: (result: { entries: ImportPlanEntry[]; livePhotosDiscarded: number; skippedFiles: SkippedFile[] }) => void
    onError: () => void
  }

  let { sourceFolder, onProgress, onSuccess, onError }: Props = $props()

  let progress: PlanProgress | null = $state(null)
  let errorMessage: string | null = $state(null)

  onMount(async () => {
    const result = await window.keepic.import.plan(sourceFolder, (p) => {
      progress = p
      onProgress(p)
    })

    if ('error' in result) {
      errorMessage = result.error
      setTimeout(() => onError(), 2000)
    } else {
      onSuccess({ entries: result.entries, livePhotosDiscarded: result.livePhotosDiscarded, skippedFiles: result.skippedFiles })
    }
  })
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-gray-900">Analysing…</h2>
    <p class="text-sm text-gray-500 font-mono mt-1 truncate">{sourceFolder}</p>
  </div>

  {#if errorMessage}
    <div class="rounded-md bg-red-50 border border-red-200 p-4">
      <p class="text-sm text-red-700">{errorMessage}</p>
      <p class="text-xs text-red-500 mt-1">Returning to home screen…</p>
    </div>
  {:else}
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
        {#if progress?.currentFile}
          <span class="font-mono text-xs truncate max-w-xs">{progress.currentFile}</span>
        {/if}
      </div>
    </div>

    <p class="text-xs text-gray-400">Analysis cannot be cancelled once started.</p>
  {/if}
</div>
