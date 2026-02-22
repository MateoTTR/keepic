<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '../components/ui/Button.svelte'
  import type { DuplicateGroup } from '../../../shared/types'

  interface Props {
    onBack: () => void
  }

  let { onBack }: Props = $props()

  let loading: boolean = $state(true)
  let groups: DuplicateGroup[] = $state([])

  onMount(async () => {
    groups = await window.keepic.library.scanDuplicates()
    loading = false
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
</script>

<div class="space-y-6">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">Duplicate Scan</h1>
      <Button variant="outline" onclick={onBack}>← Back</Button>
    </div>

    {#if loading}
      <p class="text-gray-500">Scanning…</p>
    {:else if groups.length === 0}
      <p class="text-gray-700">✓ No duplicates found</p>
    {:else}
      <p class="text-gray-700">
        {groups.length} duplicate {groups.length === 1 ? 'group' : 'groups'} found ({totalPhotos} photos total)
      </p>

      <hr class="border-gray-200" />

      <div class="space-y-6">
        {#each groups as group, i (group.phash)}
          <div class="space-y-2">
            <p class="text-sm font-semibold text-gray-700">
              Group {i + 1} — {group.photos.length} identical photos
            </p>
            <ul class="space-y-1">
              {#each group.photos as photo (photo.path)}
                <li class="flex items-center gap-4 text-sm text-gray-600 font-mono text-xs">
                  <span class="flex-1 truncate">{photo.path}</span>
                  <span class="shrink-0 text-gray-400">{formatBytes(photo.fileSize)}</span>
                  <span class="shrink-0 text-gray-400">{formatDate(photo.dateTaken)}</span>
                </li>
              {/each}
            </ul>
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
