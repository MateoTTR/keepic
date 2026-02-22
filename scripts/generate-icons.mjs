// scripts/generate-icons.mjs
// Generates resources/icon.png — a 512×512 placeholder icon (indigo-900 background)
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp'
import { mkdirSync } from 'fs'

mkdirSync('resources', { recursive: true })

await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 30, g: 58, b: 138, alpha: 1 } // tailwind indigo-900
  }
})
  .png()
  .toFile('resources/icon.png')

console.log('Generated resources/icon.png')
