import { readFileSync } from 'fs'
import sharp from 'sharp'
import { isHeicFile, defaultHeicDecode, type HeicDecodeFn } from './heic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThumbnailOptions {
  maxDim: number
}

export type ThumbnailGenerator = (
  absolutePath: string,
  options: ThumbnailOptions
) => Promise<Buffer>

export interface ThumbnailGeneratorDeps {
  decodeFn?: HeicDecodeFn
  readFile?: (path: string) => Buffer
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_QUALITY = 80

export function createThumbnailGenerator(deps: ThumbnailGeneratorDeps = {}): ThumbnailGenerator {
  const decodeFn = deps.decodeFn ?? defaultHeicDecode
  const readFile = deps.readFile ?? readFileSync

  return async (absolutePath: string, options: ThumbnailOptions): Promise<Buffer> => {
    const { maxDim } = options

    if (isHeicFile(absolutePath)) {
      const buffer = readFile(absolutePath)
      const { data, width, height } = await decodeFn(buffer)
      return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
        .resize(maxDim, maxDim, { fit: 'inside' })
        .jpeg({ quality: DEFAULT_QUALITY })
        .toBuffer()
    }

    return sharp(absolutePath)
      .resize(maxDim, maxDim, { fit: 'inside' })
      .jpeg({ quality: DEFAULT_QUALITY })
      .toBuffer()
  }
}
