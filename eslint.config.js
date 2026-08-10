import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'scratch-debug/**', 'server/autopost/**', 'server/history/**'],
  },
  js.configs.recommended,
  {
    files: ['server/pipeline/**/*.js', 'server/db/**/*.js', 'server/migrations/**/*.js', 'server/maintenance/**/*.js', 'server/routes/**/*.js', 'server/services/**/*.js', 'server/adapters/**/*.js', 'server/browserLauncher.js', 'tests/**/*.js', 'src/api.js', 'src/components/OwnerDatabaseView.jsx', 'src/components/owner/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
