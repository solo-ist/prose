# syntax=docker/dockerfile:1
# Prose Gateway — Phase 0. Single-stage build (optimize later); validated at deploy (A.5).
FROM node:22-alpine

WORKDIR /app

# Install deps (cached unless package files change)
COPY package.json package-lock.json* ./
RUN npm ci

# Generate the Prisma 7 client (WASM query compiler — no Rust engine)
COPY prisma ./prisma
RUN npx prisma generate

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

EXPOSE 4000

# Migrate-on-boot: `migrate deploy` runs before serving; a failure short-circuits
# the `&&` and the container exits non-zero (no partial-schema serving).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
