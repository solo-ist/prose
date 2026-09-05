import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Prisma 7: the connection URL lives here (not in schema.prisma). The pg driver
// adapter (@prisma/adapter-pg) is used automatically for migrations.
// Read process.env directly (not Prisma's env() helper) so a platform-injected
// DATABASE_URL (Render) is picked up at runtime, and generate still works when
// the URL is absent at build time.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
