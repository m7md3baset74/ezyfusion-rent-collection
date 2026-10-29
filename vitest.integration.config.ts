import { defineConfig } from 'vitest/config'

// Needs: local Supabase stack, a fresh `npx supabase db reset` + `npm run seed`, and the app on APP_URL
// (default http://localhost:3000). The tests create data, so reset and re-seed before running them again.
try {
  process.loadEnvFile('.env.local')
} catch {}

export default defineConfig({
  test: {
    include: ['tests/integration/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
