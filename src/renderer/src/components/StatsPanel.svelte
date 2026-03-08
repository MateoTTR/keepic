<script lang="ts">
  import type { LibraryStats } from '../../../shared/types'

  interface Props {
    stats: LibraryStats | null
  }

  let { stats }: Props = $props()

  function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
    return `${Math.round(bytes / 1e3)} KB`
  }

  function formatSource(source: string): string {
    if (source === 'google_photos') return 'Google Photos'
    return 'Local folder'
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString()
  }

  function formatMediaDateRange(oldest: string | null, newest: string | null): string | null {
    if (!oldest || !newest) return null
    const oldDate = new Date(oldest)
    const newDate = new Date(newest)
    const oldMonth = oldDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    const newMonth = newDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    if (oldMonth === newMonth) return oldMonth
    return `${oldMonth} – ${newMonth}`
  }
</script>

{#if stats !== null}
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
    <h2 class="text-lg font-semibold text-gray-900 mb-4">Library</h2>

    <p class="text-gray-700 mb-6">
      {stats.totalPhotos.toLocaleString()} photo{stats.totalPhotos !== 1 ? 's' : ''}
      {#if stats.totalVideos > 0}
        &nbsp;•&nbsp;
        {stats.totalVideos.toLocaleString()} video{stats.totalVideos !== 1 ? 's' : ''}
      {/if}
      &nbsp;•&nbsp;
      {formatBytes(stats.totalSizeBytes)}
      {#if stats.oldestDate && stats.newestDate}
        &nbsp;•&nbsp;
        {stats.oldestDate.slice(0, 4)} – {stats.newestDate.slice(0, 4)}
      {/if}
    </p>

    <p class="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Recent imports</p>
    <hr class="border-gray-200 mb-3" />

    {#if stats.recentImports.length === 0}
      <p class="text-sm text-gray-400">No imports yet</p>
    {:else}
      <ul class="space-y-2">
        {#each stats.recentImports as imp (imp.finishedAt + imp.source)}
          <li class="flex items-center justify-between text-sm">
            <span class="text-gray-700">{formatSource(imp.source)}</span>
            <span class="text-gray-400">{formatDate(imp.finishedAt)}</span>
            <span class="text-gray-700">+{imp.photosImported} photos</span>
            {#if formatMediaDateRange(imp.oldestMediaDate, imp.newestMediaDate)}
              <span class="text-gray-400 text-xs">{formatMediaDateRange(imp.oldestMediaDate, imp.newestMediaDate)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
