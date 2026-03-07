<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import { formatElapsed } from '../utils'

  interface Props {
    onBack: () => void
  }

  let { onBack }: Props = $props()

  type Status = 'starting' | 'running' | 'done' | 'error' | 'alreadyRunning'

  let status: Status = $state('starting')
  let progress: { processed: number; total: number } | null = $state(null)
  let result: { indexed: number; skipped: number; deleted: number } | null = $state(null)
  let errorMessage: string | null = $state(null)
  let startTime: number = $state(0)
  let elapsedMs: number = $state(0)

  const done = $derived(status === 'done' || status === 'error' || status === 'alreadyRunning')

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
          skipped: r.skipped ?? 0,
          deleted: r.deleted ?? 0
        }
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
        ✓ Done in {formatElapsed(elapsedMs)} — {result.indexed} indexed, {result.skipped} unchanged, {result.deleted} removed
      </p>
    {:else if status === 'alreadyRunning'}
      <p class="text-gray-500">A re-index is already in progress.</p>
    {:else if status === 'error'}
      <p class="text-red-600">✗ Error: {errorMessage}</p>
    {/if}
  </div>
</div>
