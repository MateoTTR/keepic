import eslintConfigTs from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'

export default [
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/dist-electron', 'coverage'] },
  ...eslintConfigTs,
  eslintConfigPrettier
]
