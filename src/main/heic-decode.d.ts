declare module 'heic-decode' {
  interface DecodeResult {
    width: number
    height: number
    data: Uint8ClampedArray
  }

  function decode(options: { buffer: Buffer | ArrayBuffer | Uint8Array }): Promise<DecodeResult>

  export = decode
}
