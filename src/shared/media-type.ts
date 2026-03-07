import { extname } from 'path'
import type { MediaType } from './types'

export type { MediaType }

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mts', '.3gp', '.m4v', '.mpg'])

export function isVideoExtension(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase())
}

export function getMediaType(filename: string): MediaType {
  return isVideoExtension(extname(filename).toLowerCase()) ? 'video' : 'photo'
}
