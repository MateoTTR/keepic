<script lang="ts">
  import type { Snippet } from 'svelte'
  import { clsx } from 'clsx'

  type Variant = 'default' | 'secondary' | 'outline' | 'destructive'

  interface Props {
    variant?: Variant
    class?: string
    children: Snippet
  }

  let { variant = 'default', class: className, children }: Props = $props()

  const base =
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border'

  const variants: Record<Variant, string> = {
    default: 'bg-green-100 text-green-800 border-green-200',
    secondary: 'bg-amber-100 text-amber-800 border-amber-200',
    outline: 'bg-blue-100 text-blue-800 border-blue-200',
    destructive: 'bg-red-100 text-red-800 border-red-200'
  }
</script>

<span class={clsx(base, variants[variant], className)}>
  {@render children()}
</span>
