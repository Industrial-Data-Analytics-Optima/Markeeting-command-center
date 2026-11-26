export type HubStatement = {
  bind(...args: unknown[]): HubStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type HubDatabase = {
  prepare(sql: string): HubStatement;
  batch(statements: HubStatement[]): Promise<{ meta: { changes: number } }[]>;
};

export type MediaObject = {
  body: ReadableStream<Uint8Array> | null;
  size: number;
  range?: { offset?: number; length?: number };
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type MultipartUpload = {
  uploadId: string;
  abort(): Promise<void>;
};

export type ResumedUpload = {
  uploadPart(part: number, bytes: Uint8Array): Promise<{ etag: string }>;
  complete(
    parts: { partNumber: number; etag: string }[],
  ): Promise<{ size: number }>;
  abort(): Promise<void>;
};

export type MediaBucket = {
  put(
    key: string,
    bytes: Uint8Array | ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
  get(
    key: string,
    options?: { range?: Headers | { offset: number; length: number } },
  ): Promise<MediaObject | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): ResumedUpload;
};

export type HubEnv = {
  DB: HubDatabase;
  MEDIA: MediaBucket;
  TOKEN_VAULT_KEY?: string;
  APP_ORIGIN?: string;
  SCHEDULER_SECRET?: string;
  EMAIL_SYNC_ENABLED?: string;
  EMAIL_DELIVERY_ENABLED?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;
  META_GRAPH_VERSION?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_API_VERSION?: string;
  LINKEDIN_FEED_PERMISSIONS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
};
