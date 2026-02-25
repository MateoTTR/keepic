<script lang="ts">
  import Button from '../components/ui/Button.svelte'
  import type { GoogleDownloadResult } from '../../../shared/types'

  interface Props {
    onDownloadComplete: (result: GoogleDownloadResult) => void
    onBack: () => void
  }

  let { onBack }: Props = $props()
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <div>
    <h2 class="text-xl font-semibold text-gray-900">Import from Google Photos</h2>
    <p class="text-sm text-gray-500 mt-1">Google Photos import is being upgraded.</p>
  </div>

  <div class="rounded-md bg-amber-50 border border-amber-200 p-4">
    <p class="text-sm text-amber-800">
      The Google Photos integration is currently being migrated to the new Picker API.
      This feature will be available again shortly.
    </p>
  </div>

  <Button variant="outline" onclick={onBack}>← Back</Button>
</div>
