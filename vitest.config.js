import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: { include: ['server/pipeline/**/*.js', 'server/db/**/*.js'] },
  },
})
