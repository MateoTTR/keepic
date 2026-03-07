import { readFileSync } from 'fs'
import sharp from 'sharp'
import { isHeicFile, defaultHeicDecode, type HeicDecodeFn } from './heic'
import { isVideoExtension } from '../shared/media-type'
import { extname } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThumbnailOptions {
  maxDim: number
}

export interface ThumbnailResult {
  buffer: Buffer
  contentType: string
}

export type ThumbnailGenerator = (
  absolutePath: string,
  options: ThumbnailOptions
) => Promise<ThumbnailResult>

export interface ThumbnailGeneratorDeps {
  decodeFn?: HeicDecodeFn
  readFile?: (path: string) => Buffer
}

// ---------------------------------------------------------------------------
// Video placeholder SVG
// ---------------------------------------------------------------------------

const VIDEO_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect width="300" height="300" fill="#374151"/>
  <polygon points="120,90 120,210 210,150" fill="#9CA3AF"/>
</svg>`

export function getVideoPlaceholderBuffer(): Buffer {
  return Buffer.from(VIDEO_PLACEHOLDER_SVG, 'utf-8')
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_QUALITY = 80

export function createThumbnailGenerator(deps: ThumbnailGeneratorDeps = {}): ThumbnailGenerator {
  const decodeFn = deps.decodeFn ?? defaultHeicDecode
  const readFile = deps.readFile ?? readFileSync

  return async (absolutePath: string, options: ThumbnailOptions): Promise<ThumbnailResult> => {
    const { maxDim } = options

    if (isVideoExtension(extname(absolutePath))) {
      return {
        buffer: getVideoPlaceholderBuffer(),
        contentType: 'image/svg+xml'
      }
    }

    if (isHeicFile(absolutePath)) {
      const buffer = readFile(absolutePath)
      const { data, width, height } = await decodeFn(buffer)
      return {
        buffer: await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
          .resize(maxDim, maxDim, { fit: 'inside' })
          .jpeg({ quality: DEFAULT_QUALITY })
          .toBuffer(),
        contentType: 'image/jpeg'
      }
    }

    return {
      buffer: await sharp(absolutePath)
        .resize(maxDim, maxDim, { fit: 'inside' })
        .jpeg({ quality: DEFAULT_QUALITY })
        .toBuffer(),
      contentType: 'image/jpeg'
    }
  }
}
