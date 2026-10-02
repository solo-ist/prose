-- AlterTable: add hostLabel for per-publication subdomain isolation (#917).
-- NULL on existing rows; backfilled immediately with a 16-char random hex
-- label derived from md5(random()::text || id) so every existing publication
-- gets a stable, unique label without requiring a new token or any secret.
ALTER TABLE "publications" ADD COLUMN "hostLabel" TEXT;

-- Backfill existing rows.
UPDATE "publications"
SET "hostLabel" = substr(md5(random()::text || id), 1, 16)
WHERE "hostLabel" IS NULL;

-- Add the unique constraint (safe now — every row has a value).
CREATE UNIQUE INDEX "publications_hostLabel_key" ON "publications"("hostLabel");
