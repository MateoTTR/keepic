<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import StatsPanel from '../components/StatsPanel.svelte'
  import type { LibraryStats } from '../../../shared/types'

  interface Props {
    libraryPath: string | null
    onLibraryPathChange: (path: string) => void
    onDedupScan: () => void
    onReindex: () => void
  }

  let { libraryPath, onLibraryPathChange, onDedupScan, onReindex }: Props = $props()

  let stats: LibraryStats | null = $state(null)

  onMount(async () => {
    stats = await window.keepic.library.getStats()
  })

  export async function refreshStats(): Promise<void> {
    stats = await window.keepic.library.getStats()
  }

  async function configureLibraryFolder(): Promise<void> {
    const result = await window.keepic.config.selectLibraryFolder()
    if (!result.cancelled && result.path) {
      onLibraryPathChange(result.path)
      stats = await window.keepic.library.getStats()
    }
  }
</script>

<div class="space-y-6">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Library</h1>
      <p class="text-gray-500 mt-1">Manage your photo & video library</p>
    </div>

    <!-- Library folder configuration -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Library folder</p>
      {#if libraryPath}
        <p class="text-sm text-gray-600 font-mono text-xs bg-gray-100 px-2 py-1 rounded break-all">{libraryPath}</p>
        <Button variant="outline" onclick={configureLibraryFolder}>Change…</Button>
        {#if stats !== null && stats.totalPhotos === 0}
          <div class="bg-amber-50 border border-amber-200 rounded p-3">
            <p class="text-sm text-amber-700">Library not indexed yet. Click <strong>Re-index library</strong> below before importing to detect existing duplicates.</p>
          </div>
        {/if}
      {:else}
        <p class="text-sm text-amber-600 font-medium">No library folder configured. Select a folder before importing photos.</p>
        <Button onclick={configureLibraryFolder}>Configure library folder…</Button>
      {/if}
    </div>

    <hr class="border-gray-200" />

    <!-- Library actions -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Actions</p>
      <div class="flex gap-3">
        <Button variant="outline" onclick={onReindex}>Re-index library</Button>
        <Button variant="outline" onclick={onDedupScan}>Scan for duplicates</Button>
      </div>
    </div>
  </div>

  <StatsPanel {stats} />
</div>
