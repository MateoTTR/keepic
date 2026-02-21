import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Only test non-frontend code: main process, workers, shared utilities
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['tests/renderer/**', 'node_modules/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/main/**/*.ts',
        'src/workers/**/*.ts',
        'src/shared/**/*.ts'
      ],
      exclude: [
        'src/main/index.ts',       // Electron entry point — not unit-testable
        'src/shared/types/**',     // Type-only files — no executable code
        'src/renderer/**',
        'src/preload/**'
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      },
      reporter: ['text', 'lcov', 'html']
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
