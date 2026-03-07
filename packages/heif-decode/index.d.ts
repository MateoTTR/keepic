export interface HeifInfo {
  width: number
  height: number
  hasAlphaChannel: boolean
}

export interface HeifDecodeResult {
  width: number
  height: number
  data: Buffer
}

/** Synchronous HEIC decode — returns raw RGBA pixel buffer. */
export function decode(buffer: Buffer): Buffer

/** Async HEIC decode — runs in libuv threadpool, returns Promise. */
export function decodeAsync(buffer: Buffer): Promise<HeifDecodeResult>

/** Synchronous — reads HEIC header info without decoding pixels. */
export function getInfo(buffer: Buffer): HeifInfo

/** Alias for getInfo (backward compat with libheif-node-dy). */
export function get_info(buffer: Buffer): HeifInfo
