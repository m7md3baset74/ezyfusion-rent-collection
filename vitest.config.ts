import { defineConfig } from 'vitest/config'

// Unit tests only (pure modules). The API/RLS/Storage tests in tests/integration need a running stack:
// see vitest.integration.config.ts and `npm run test:api`.
export default defineConfig({
  test: { include: ['tests/*.test.ts'] },
})
