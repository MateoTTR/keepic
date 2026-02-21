import { FlatCompat } from '@eslint/eslintrc'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const tsConfigs = compat
  .extends('@electron-toolkit/eslint-config-ts', '@electron-toolkit/eslint-config-prettier')
  .map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] }))

export default [
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/dist-electron', 'coverage'] },
  ...tsConfigs
]
