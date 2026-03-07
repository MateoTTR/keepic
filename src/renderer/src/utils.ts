export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  return new Date(isoDate).toLocaleDateString()
}

export function thumbnailUrl(opts: {
  absolutePath?: string
  libraryRelPath?: string
  maxDim?: number
}): string {
  const params = new URLSearchParams()
  if (opts.absolutePath) {
    params.set('path', opts.absolutePath)
  } else if (opts.libraryRelPath) {
    params.set('libraryRelPath', opts.libraryRelPath)
  }
  if (opts.maxDim) {
    params.set('maxDim', String(opts.maxDim))
  }
  return `keepic-photo://thumbnail?${params.toString()}`
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
