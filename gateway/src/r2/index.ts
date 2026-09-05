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

export const r2Configured = Boolean(
  config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY,
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
