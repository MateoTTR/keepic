<script lang="ts">
  interface Props {
    value: number
    max?: number
    class?: string
  }

  let { value, max = 100, class: className }: Props = $props()

  const percent = $derived(max > 0 ? Math.min(100, (value / max) * 100) : 0)
</script>

<div class="relative w-full overflow-hidden rounded-full bg-gray-200 h-3 {className ?? ''}">
  <div
    class="h-full bg-blue-600 transition-all duration-200 ease-in-out rounded-full"
    style="width: {percent}%"
  ></div>
</div>
