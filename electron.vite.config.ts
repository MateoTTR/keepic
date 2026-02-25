import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    envPrefix: ['MAIN_VITE_', 'GOOGLE_'],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'workers/indexer.worker': resolve('src/workers/indexer.worker.ts'),
          'workers/planner.worker': resolve('src/workers/planner.worker.ts'),
          'workers/importer.worker': resolve('src/workers/importer.worker.ts'),
          'workers/google-photos-picker.worker': resolve('src/workers/google-photos-picker.worker.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [svelte()]
  }
})
