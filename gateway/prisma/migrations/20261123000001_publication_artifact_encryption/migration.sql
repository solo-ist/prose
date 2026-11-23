-- AlterTable: link-bound encryption for stored share artifacts
-- (src/artifacts/crypto.ts). Nullable and additive: existing rows keep their
-- plaintext artifact until their first view seals it, so no backfill (the
-- server can't seal a row without its share token, which it never stores).
ALTER TABLE "publications" ADD COLUMN "artifactCipher" BYTEA,
ADD COLUMN "encPublicKey" TEXT,
ADD COLUMN "encWrappedKey" TEXT;
