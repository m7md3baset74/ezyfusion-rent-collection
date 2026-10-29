import { defineConfig } from 'prisma/config'

// The Prisma CLI does not read .env.local itself. Missing file is fine (e.g. `prisma generate` during npm install).
try {
  process.loadEnvFile('.env.local')
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Only used by CLI commands such as `prisma db pull`; the app connects through lib/prisma.ts.
    url: process.env.DIRECT_URL ?? '',
  },
})