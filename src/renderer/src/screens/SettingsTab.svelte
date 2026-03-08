<script lang="ts">
  import type { AppConfig } from '../../../shared/types'

  interface Props {
    heicMode: AppConfig['heic']['mode']
    onHeicModeChange: (mode: AppConfig['heic']['mode']) => void
  }

  let { heicMode, onHeicModeChange }: Props = $props()

  async function setHeicMode(mode: AppConfig['heic']['mode']): Promise<void> {
    const updated = await window.keepic.config.setHeicConfig({ mode, jpegQuality: 90 })
    onHeicModeChange(updated.heic.mode)
  }
</script>

<div class="space-y-6">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Settings</h1>
      <p class="text-gray-500 mt-1">Configure KeePic preferences</p>
    </div>

    <!-- HEIC mode -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">HEIC files</p>
      <div class="flex items-center gap-3">
        <div class="inline-flex rounded-md shadow-sm" role="group">
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-l-md border {heicMode === 'keep' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
            onclick={() => setHeicMode('keep')}
          >
            Keep original
          </button>
          <button
            class="px-3 py-1.5 text-sm font-medium rounded-r-md border border-l-0 {heicMode === 'convert' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
            onclick={() => setHeicMode('convert')}
          >
            Convert to JPEG
          </button>
        </div>
      </div>
      <p class="text-xs text-gray-400">
        {#if heicMode === 'keep'}
          HEIC photos are imported as-is. Not all viewers support this format.
        {:else}
          HEIC photos are converted to JPEG during import (quality 90%).
        {/if}
      </p>
    </div>
  </div>
</div>
