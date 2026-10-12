/**
 * r2/index.ts — Cloudflare R2 client (S3-compatible). BLOBS ONLY — embedded
 * images, attachments, flat-HTML share snapshots, future hosted-OCR (#439).
 * Document markdown lives in Postgres, never here.
 *
 * Phase 0: configured but UNUSED. Constructing it proves the env + SDK wiring
 * before Phase 2 needs real uploads. Returns null when R2 isn't configured.
 */
import { S3Client } from '@aws-sdk/client-s3'
import { config } from '../config.js'

// All four credentials are required to be operational — R2_BUCKET is needed
// for every object operation, so a partial set (credentials without a bucket)
// is treated as unconfigured rather than deferring the failure to first use.
export const r2Configured = Boolean(
  config.R2_ACCOUNT_ID &&
  config.R2_ACCESS_KEY_ID &&
  config.R2_SECRET_ACCESS_KEY &&
  config.R2_BUCKET,
)

export const r2: S3Client | null = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID as string,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY as string,
      },
    })
  : null

// Boot-time notice: operators provisioning R2 later is explicitly supported
// (existing DB-stored artifacts strand nothing), but silence here made the
// "all new artifacts land in Postgres" posture invisible. One warn at startup
// makes the storage mode auditable without requiring a log search.
if (!r2Configured) {
  console.warn(
    '[r2] R2 is not configured — artifacts will be stored in Postgres (acceptable for beta; ' +
    'set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET to enable R2 storage).',
  )
}
