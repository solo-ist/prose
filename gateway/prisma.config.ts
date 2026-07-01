import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7: the connection URL lives here (not in schema.prisma). The pg driver
// adapter (@prisma/adapter-pg) is used automatically for migrations.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
