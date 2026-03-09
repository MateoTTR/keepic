<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  interface Props {
    estimatedHeight?: number
    rootMargin?: string
    children: import('svelte').Snippet
  }

  let { estimatedHeight = 280, rootMargin = '200px', children }: Props = $props()

  let visible: boolean = $state(false)
  let measured: boolean = $state(false)
  let lastHeight: number = $state(0)

  $effect(() => {
    if (!measured) lastHeight = estimatedHeight
  })
  let container: HTMLDivElement | undefined = $state()
  let observer: IntersectionObserver | undefined

  onMount(() => {
    if (!container) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible = true
          } else {
            if (measured && container) {
              lastHeight = container.offsetHeight
            }
            visible = false
          }
        }
      },
      { rootMargin }
    )
    observer.observe(container)
  })

  onDestroy(() => {
    observer?.disconnect()
  })

  function onContentMount(node: HTMLDivElement): { destroy: () => void } {
    measured = true
    lastHeight = node.offsetHeight
    return { destroy() {} }
  }
</script>

<div bind:this={container}>
  {#if visible}
    <div use:onContentMount>
      {@render children()}
    </div>
  {:else}
    <div style="height: {lastHeight}px" class="bg-gray-50 rounded"></div>
  {/if}
</div>
