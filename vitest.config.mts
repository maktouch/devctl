import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Some tests use process.chdir(), which is unavailable in worker threads.
    pool: 'forks',
  },
})
