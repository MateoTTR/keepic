<script lang="ts">
  import Button from '../components/ui/Button.svelte'

  interface Props {
    sourceFolder: string
    onSourceFolder: (folder: string) => void
    onAnalyse: () => void
  }

  let { sourceFolder, onSourceFolder, onAnalyse }: Props = $props()

  async function selectFolder(): Promise<void> {
    const result = await window.keepic.import.selectSourceFolder()
    if (!result.cancelled && result.path) {
      onSourceFolder(result.path)
    }
  }
</script>

<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-gray-900">KeePic</h1>
    <p class="text-gray-500 mt-1">Import photos from a local folder or SD card</p>
  </div>

  <div class="space-y-3">
    <Button onclick={selectFolder}>Select folder…</Button>

    {#if sourceFolder}
      <p class="text-sm text-gray-600">
        <span class="font-medium">Selected:</span>
        <span class="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded ml-1">{sourceFolder}</span>
      </p>
    {:else}
      <p class="text-sm text-gray-400">No folder selected</p>
    {/if}
  </div>

  <div>
    <Button
      onclick={onAnalyse}
      disabled={!sourceFolder}
    >
      Analyse →
    </Button>
  </div>
</div>
