import { openDatabase } from "./sqlite";
import { blobMedia } from "./media";
import type { HubEnv, MediaBucket } from "./types";

const strings = {
  TOKEN_VAULT_KEY: process.env.TOKEN_VAULT_KEY,
  APP_ORIGIN:
    process.env.APP_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
      : undefined),
  SCHEDULER_SECRET: process.env.SCHEDULER_SECRET || process.env.CRON_SECRET,
  EMAIL_SYNC_ENABLED: process.env.EMAIL_SYNC_ENABLED,
  EMAIL_DELIVERY_ENABLED: process.env.EMAIL_DELIVERY_ENABLED,
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_LOGIN_CONFIG_ID: process.env.META_LOGIN_CONFIG_ID,
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v27.0",
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
  LINKEDIN_API_VERSION: process.env.LINKEDIN_API_VERSION || "202609",
  LINKEDIN_FEED_PERMISSIONS: process.env.LINKEDIN_FEED_PERMISSIONS,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
};

let mediaReady: Promise<MediaBucket> | undefined;
const mediaBucket = () => (mediaReady ??= blobMedia());
const lazyMedia: MediaBucket = {
  put: async (...args) => (await mediaBucket()).put(...args),
  get: async (...args) => (await mediaBucket()).get(...args),
  head: async (...args) => (await mediaBucket()).head(...args),
  delete: async (...args) => (await mediaBucket()).delete(...args),
  createMultipartUpload: async (...args) =>
    (await mediaBucket()).createMultipartUpload(...args),
  resumeMultipartUpload: (...args) => ({
    uploadPart: async (...part) =>
      (await mediaBucket()).resumeMultipartUpload(...args).uploadPart(...part),
    complete: async (parts) =>
      (await mediaBucket()).resumeMultipartUpload(...args).complete(parts),
    abort: async () =>
      (await mediaBucket()).resumeMultipartUpload(...args).abort(),
  }),
};

export const env = {
  ...strings,
  get DB() {
    return openDatabase() as unknown as D1Database;
  },
  get MEDIA() {
    if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN)
      return undefined as unknown as R2Bucket;
    return lazyMedia as unknown as R2Bucket;
  },
} as HubEnv & { DB: D1Database; MEDIA: R2Bucket };

export type { HubDatabase, HubEnv, MediaBucket } from "./types";
