import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'

// Connects as the database owner (DATABASE_URL), so RLS does not apply: every query that uses this
// client must be scoped by the caller's organization in lib/server/*.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 10 }) })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
