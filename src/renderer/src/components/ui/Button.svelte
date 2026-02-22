<script lang="ts">
  import type { Snippet } from 'svelte'
  import { clsx } from 'clsx'

  type Variant = 'default' | 'outline' | 'ghost' | 'destructive'
  type Size = 'sm' | 'md' | 'lg'

  interface Props {
    variant?: Variant
    size?: Size
    disabled?: boolean
    class?: string
    onclick?: () => void
    children: Snippet
  }

  let {
    variant = 'default',
    size = 'md',
    disabled = false,
    class: className,
    onclick,
    children
  }: Props = $props()

  const base =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'

  const variants: Record<Variant, string> = {
    default: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
    outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400',
    ghost: 'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400',
    destructive: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600'
  }

  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-11 px-6 text-base'
  }
</script>

<button
  class={clsx(base, variants[variant], sizes[size], className)}
  {disabled}
  {onclick}
>
  {@render children()}
</button>
