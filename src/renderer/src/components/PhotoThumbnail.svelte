<script lang="ts">
  interface Props {
    src: string
    alt: string
    class?: string
  }

  let { src, alt, class: className = '' }: Props = $props()

  let state: 'loading' | 'loaded' | 'error' = $state('loading')
</script>

<div class="relative inline-block bg-gray-100 rounded overflow-hidden {className}">
  {#if state === 'loading'}
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
    </div>
  {/if}

  {#if state === 'error'}
    <div class="flex flex-col items-center justify-center w-full h-full text-gray-400 p-4">
      <svg class="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M3 3l18 18" />
      </svg>
      <span class="text-xs">Preview unavailable</span>
    </div>
  {:else}
    <img
      {src}
      {alt}
      loading="lazy"
      class="block max-w-full h-auto {state === 'loading' ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200"
      onload={() => { state = 'loaded' }}
      onerror={() => { state = 'error' }}
    />
  {/if}
</div>
