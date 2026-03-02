import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@exodus/bytes/encoding-lite.js': '/src/test/shims/encoding-lite.cjs',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    pool: 'threads',
  },
})
