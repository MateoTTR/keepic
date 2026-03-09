<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import PhotoThumbnail from '../components/PhotoThumbnail.svelte'
  import { thumbnailUrl } from '../utils'
  import type { DuplicateGroup } from '../../../shared/types'

  interface Props {
    onBack: () => void
  }

  let { onBack }: Props = $props()

  let loading: boolean = $state(true)
  let groups: DuplicateGroup[] = $state([])
  let progress: { processed: number; total: number } | null = $state(null)

  onMount(() => {
    window.keepic.library.onDedupProgress((p) => {
      progress = p
    })
    window.keepic.library.onDedupComplete((result) => {
      groups = result.groups
      loading = false
    })
    window.keepic.library.scanDuplicates()
  })

  onDestroy(() => {
    window.keepic.library.removeDedupListeners()
  })

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return '—'
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
    return `${Math.round(bytes / 1e3)} KB`
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString()
  }

  const totalPhotos = $derived(groups.reduce((sum, g) => sum + g.photos.length, 0))
  const photoGroups = $derived(groups.filter((g) => g.mediaType === 'photo').length)
  const videoGroups = $derived(groups.filter((g) => g.mediaType === 'video').length)
  const progressPercent = $derived(
    progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0
  )
</script>

<div class="space-y-6">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">Duplicate Scan</h1>
      <Button variant="outline" onclick={onBack}>← Back</Button>
    </div>

    {#if loading}
      {#if progress}
        <div class="space-y-2">
          <p class="text-gray-500">Scanning for duplicates… {progressPercent}%</p>
          <div class="w-full bg-gray-200 rounded-full h-2">
            <div
              class="bg-blue-600 h-2 rounded-full transition-all duration-200"
              style="width: {progressPercent}%"
            ></div>
          </div>
          <p class="text-xs text-gray-400">{progress.processed} / {progress.total} photos analyzed</p>
        </div>
      {:else}
        <p class="text-gray-500">Loading…</p>
      {/if}
    {:else if groups.length === 0}
      <p class="text-gray-700">✓ No duplicates found</p>
    {:else}
      <p class="text-gray-700">
        {groups.length} duplicate {groups.length === 1 ? 'group' : 'groups'} found ({totalPhotos} file{totalPhotos !== 1 ? 's' : ''} total{#if videoGroups > 0 && photoGroups > 0} — {photoGroups} photo, {videoGroups} video{/if})
      </p>

      <hr class="border-gray-200" />

      <div class="space-y-6">
        {#each groups as group, i (group.phash)}
          <div class="space-y-2">
            <p class="text-sm font-semibold text-gray-700">
              Group {i + 1} — {group.photos.length} identical {group.mediaType === 'video' ? 'videos' : 'photos'}
            </p>
            <div class="flex flex-wrap gap-4">
              {#each group.photos as photo (photo.path)}
                <div class="w-48 space-y-2">
                  <PhotoThumbnail
                    src={thumbnailUrl({ libraryRelPath: photo.path })}
                    alt={photo.filename}
                    class="w-full aspect-auto"
                  />
                  <div class="space-y-0.5">
                    <p class="font-mono text-xs text-gray-700 truncate" title={photo.path}>{photo.path}</p>
                    <p class="text-xs text-gray-400">
                      {formatBytes(photo.fileSize)}
                      <span class="mx-1">&middot;</span>
                      {formatDate(photo.dateTaken)}
                    </p>
                    <Button variant="outline" size="sm" onclick={() => window.keepic.shell.revealLibraryFile(photo.path)}>
                      Reveal in Folder
                    </Button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <hr class="border-gray-200" />

      <p class="text-sm text-gray-500">
        To remove duplicates: delete the unwanted files from the shared folder, then re-index.
      </p>
    {/if}
  </div>
</div>
