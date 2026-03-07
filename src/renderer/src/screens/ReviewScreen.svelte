<script lang="ts">
  import type { ImportPlanEntry } from '../../../shared/types'
  import Button from '../components/ui/Button.svelte'
  import Badge from '../components/ui/Badge.svelte'
  import Separator from '../components/ui/Separator.svelte'
  import { formatBytes, formatDate, formatElapsed } from '../utils'

  interface Props {
    plan: ImportPlanEntry[]
    livePhotosDiscarded: number
    analysisElapsedMs: number
    onImport: (modifiedPlan: ImportPlanEntry[]) => void
    onCancel: () => void
  }

  let { plan, livePhotosDiscarded, analysisElapsedMs, onImport, onCancel }: Props = $props()

  // Local mutable copy so user can toggle duplicates to "ready"
  let localPlan: ImportPlanEntry[] = $state(plan.map((e) => ({ ...e })))

  // Sorted: ready/collision first, then duplicates, then errors
  const sortedPlan = $derived(
    [...localPlan].sort((a, b) => {
      const order = { ready: 0, collision: 1, duplicate: 2, error: 3 }
      return order[a.status] - order[b.status]
    })
  )

  const counts = $derived({
    ready: localPlan.filter((e) => e.status === 'ready').length,
    duplicate: localPlan.filter((e) => e.status === 'duplicate').length,
    collision: localPlan.filter((e) => e.status === 'collision').length,
    error: localPlan.filter((e) => e.status === 'error').length
  })

  const importCount = $derived(
    localPlan.filter((e) => e.status === 'ready' || e.status === 'collision').length
  )

  let expandedPath: string | null = $state(null)

  function toggleExpand(entry: ImportPlanEntry): void {
    if (entry.status === 'duplicate' || entry.status === 'collision') {
      expandedPath = expandedPath === entry.sourcePath ? null : entry.sourcePath
    }
  }

  function importAnyway(entry: ImportPlanEntry): void {
    const idx = localPlan.findIndex((e) => e.sourcePath === entry.sourcePath)
    if (idx >= 0) {
      localPlan[idx] = { ...localPlan[idx], status: 'ready' }
      expandedPath = null
    }
  }

  function filename(sourcePath: string): string {
    return sourcePath.split(/[/\\]/).pop() ?? sourcePath
  }

  function badgeVariant(status: ImportPlanEntry['status']): 'default' | 'secondary' | 'outline' | 'destructive' {
    if (status === 'ready') return 'default'
    if (status === 'duplicate') return 'secondary'
    if (status === 'collision') return 'outline'
    return 'destructive'
  }

  function badgeLabel(status: ImportPlanEntry['status']): string {
    if (status === 'ready') return 'Ready'
    if (status === 'duplicate') return 'Duplicate'
    if (status === 'collision') return 'Collision'
    return 'Error'
  }
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
  <!-- Header -->
  <div class="p-6 space-y-3">
    <h2 class="text-xl font-semibold text-gray-900">
      Import plan — {localPlan.length} file{localPlan.length !== 1 ? 's' : ''}
      <span class="text-sm font-normal text-gray-400 ml-2">analysed in {formatElapsed(analysisElapsedMs)}</span>
    </h2>

    <!-- Summary bar -->
    <div class="flex flex-wrap gap-3 text-sm">
      <span class="text-green-700">● {counts.ready} ready</span>
      <span class="text-amber-700">◆ {counts.duplicate} duplicate{counts.duplicate !== 1 ? 's' : ''}</span>
      <span class="text-blue-700">▲ {counts.collision} collision{counts.collision !== 1 ? 's' : ''}</span>
      <span class="text-red-700">✕ {counts.error} error{counts.error !== 1 ? 's' : ''}</span>
      {#if livePhotosDiscarded > 0}
        <span class="text-gray-500">⊘ {livePhotosDiscarded} Live Photo video{livePhotosDiscarded !== 1 ? 's' : ''} discarded</span>
      {/if}
    </div>
  </div>

  <Separator />

  <!-- Column headers -->
  <div class="grid grid-cols-[1fr_2fr_auto_auto] gap-4 px-6 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide bg-gray-50">
    <span>Name</span>
    <span>Destination</span>
    <span>Status</span>
    <span></span>
  </div>

  <Separator />

  <!-- Entry list -->
  <div class="divide-y divide-gray-100 max-h-96 overflow-y-auto">
    {#each sortedPlan as entry (entry.sourcePath)}
      {@const isExpanded = expandedPath === entry.sourcePath}
      {@const isExpandable = entry.status === 'duplicate' || entry.status === 'collision'}

      <!-- Row -->
      <div
        class="grid grid-cols-[1fr_2fr_auto_auto] gap-4 px-6 py-3 items-center text-sm {isExpandable ? 'cursor-pointer hover:bg-gray-50' : ''}"
        onclick={() => isExpandable && toggleExpand(entry)}
        role={isExpandable ? 'button' : undefined}
        tabindex={isExpandable ? 0 : undefined}
        onkeydown={(e) => e.key === 'Enter' && isExpandable && toggleExpand(entry)}
      >
        <span class="font-mono text-xs truncate text-gray-800">{filename(entry.sourcePath)}</span>
        <span class="text-xs text-gray-500 truncate">
          {#if entry.status === 'duplicate'}
            (duplicate)
          {:else}
            {entry.destinationRelativePath}
          {/if}
        </span>
        <Badge variant={badgeVariant(entry.status)}>{badgeLabel(entry.status)}</Badge>
        <span class="text-gray-400 w-4 text-center">
          {#if isExpandable}
            {isExpanded ? '▲' : '▼'}
          {/if}
        </span>
      </div>

      <!-- Expanded detail -->
      {#if isExpanded}
        <div class="bg-gray-50 border-t border-gray-100 px-6 py-4 text-sm space-y-2">
          {#if entry.status === 'collision'}
            <p class="text-gray-600">
              <span class="font-medium">Renamed to:</span>
              <span class="font-mono text-xs ml-1">{entry.destinationRelativePath}</span>
            </p>
            {#if entry.originalDestination}
              <p class="text-xs text-gray-400">
                Original name was already taken: <span class="font-mono">{entry.originalDestination}</span>
              </p>
            {/if}
          {:else if entry.status === 'duplicate'}
            <div class="space-y-1">
              <p class="text-gray-600">
                <span class="font-medium">Source:</span>
                <span class="font-mono text-xs ml-1">{filename(entry.sourcePath)}</span>
                <span class="text-gray-400 mx-1">•</span>
                {formatBytes(entry.fileSize)}
                <span class="text-gray-400 mx-1">•</span>
                {formatDate(entry.dateTaken)}
              </p>
              <p class="text-gray-600">
                <span class="font-medium">Matches:</span>
                <span class="font-mono text-xs ml-1">{entry.duplicateOf ?? '—'}</span>
              </p>
            </div>
            <div class="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onclick={() => { expandedPath = null }}>
                Skip ✓
              </Button>
              <Button size="sm" onclick={() => importAnyway(entry)}>
                Import anyway
              </Button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Error inline message -->
      {#if entry.status === 'error' && entry.errorMessage}
        <div class="bg-red-50 px-6 py-2 text-xs text-red-600 border-t border-red-100">
          {entry.errorMessage}
        </div>
      {/if}
    {/each}
  </div>

  <Separator />

  <!-- Footer actions -->
  <div class="flex justify-end gap-3 p-6">
    <Button variant="outline" onclick={onCancel}>Cancel</Button>
    <Button
      disabled={importCount === 0}
      onclick={() => onImport(localPlan)}
    >
      Import {importCount} file{importCount !== 1 ? 's' : ''} →
    </Button>
  </div>
</div>
