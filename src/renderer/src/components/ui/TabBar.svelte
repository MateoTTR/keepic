<script lang="ts">
  interface Tab {
    id: string
    label: string
  }

  interface Props {
    tabs: Tab[]
    activeTab: string
    disabled?: boolean
    onTabChange: (tabId: string) => void
  }

  let { tabs, activeTab, disabled = false, onTabChange }: Props = $props()
</script>

<nav class="flex border-b border-gray-200 bg-white px-4" aria-label="Tabs">
  {#each tabs as tab (tab.id)}
    <button
      class="px-4 py-3 text-sm font-medium border-b-2 transition-colors {tab.id === activeTab
        ? 'border-blue-600 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} {disabled && tab.id !== activeTab ? 'opacity-40 cursor-not-allowed' : ''}"
      disabled={disabled && tab.id !== activeTab}
      onclick={() => onTabChange(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>
