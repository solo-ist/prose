# syntax=docker/dockerfile:1
# Prose Gateway — Phase 0. Single-stage build (optimize later); validated at deploy (A.5).
FROM node:22-alpine

WORKDIR /app

# Install deps (cached unless package files change)
COPY package.json package-lock.json* ./
RUN npm ci

# Generate the Prisma 7 client (WASM query compiler — no Rust engine).
# prisma.config.ts (gateway root) holds the datasource URL + migrations path —
# it MUST be in the image or `prisma migrate deploy` has no datasource.url.
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
RUN npx prisma generate

# Build TypeScript
COPY src ./src
RUN npx tsc

# Drop root: node:22-alpine ships a `node` user (uid 1000); migrate deploy and
# the server only need read access to /app plus a DB connection.
USER node

EXPOSE 4000

# Migrate-on-boot: `migrate deploy` runs before serving; a failure short-circuits
# the `&&` and the container exits non-zero (no partial-schema serving).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
