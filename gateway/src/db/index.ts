/**
 * db/index.ts — the Prisma 7 client singleton.
 * Prisma 7 connects through a driver adapter (@prisma/adapter-pg over `pg`);
 * the connection string comes from config (validated env).
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { config } from '../config.js'

const adapter = new PrismaPg({ connectionString: config.DATABASE_URL })

export const prisma = new PrismaClient({ adapter })

export type DbStatus = 'connected' | 'error' | 'unconfigured'

/** Cheap liveness probe for /health. Never throws. */
export async function pingDb(): Promise<DbStatus> {
  if (!config.DATABASE_URL) return 'unconfigured'
  try {
    await prisma.$queryRaw`SELECT 1`
    return 'connected'
  } catch {
    return 'error'
  }
}
