<script lang="ts">
  import type { AppConfig } from '../../../shared/types'

  interface Props {
    heicMode: AppConfig['heic']['mode']
    onHeicModeChange: (mode: AppConfig['heic']['mode']) => void
    dedupThreshold: number
    onDedupThresholdChange: (threshold: number) => void
  }

  let { heicMode, onHeicModeChange, dedupThreshold, onDedupThresholdChange }: Props = $props()

  async function setHeicMode(mode: AppConfig['heic']['mode']): Promise<void> {
    const updated = await window.keepic.config.setHeicConfig({ mode, jpegQuality: 90 })
    onHeicModeChange(updated.heic.mode)
  }

  async function setDedupThreshold(value: number): Promise<void> {
    const updated = await window.keepic.config.setDedupThreshold(value)
    onDedupThresholdChange(updated.dedupThreshold)
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

    <!-- Dedup threshold -->
    <div class="space-y-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Duplicate detection</p>
      <div class="flex items-center gap-3">
        <label class="text-sm text-gray-700" for="dedup-threshold">Hamming distance threshold</label>
        <div class="inline-flex rounded-md shadow-sm" role="group">
          {#each [0, 1, 2, 3, 4] as value (value)}
            <button
              class="px-3 py-1.5 text-sm font-medium border {value === 0 ? 'rounded-l-md' : ''} {value === 4 ? 'rounded-r-md' : ''} {value > 0 ? 'border-l-0' : ''} {dedupThreshold === value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}"
              onclick={() => setDedupThreshold(value)}
            >
              {value}
            </button>
          {/each}
        </div>
      </div>
      <p class="text-xs text-gray-400">
        {#if dedupThreshold === 0}
          Exact match — only photos with identical perceptual hashes are considered duplicates. Recommended.
        {:else}
          Tolerance of {dedupThreshold} bit{dedupThreshold > 1 ? 's' : ''} — photos with slightly different hashes may be grouped. Higher values increase false positives.
        {/if}
      </p>
    </div>
  </div>
</div>
