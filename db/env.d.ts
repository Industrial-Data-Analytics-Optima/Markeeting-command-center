declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EMAIL_SYNC_ENABLED?: string;
    EMAIL_DELIVERY_ENABLED?: string;
    MEDIA?: R2Bucket;
    SCHEDULER_SECRET?: string;
    META_APP_ID?: string;
    META_APP_SECRET?: string;
    META_LOGIN_CONFIG_ID?: string;
    META_GRAPH_VERSION?: string;
    LINKEDIN_CLIENT_ID?: string;
    LINKEDIN_CLIENT_SECRET?: string;
    LINKEDIN_API_VERSION?: string;
    LINKEDIN_FEED_PERMISSIONS?: string;
    APP_ORIGIN?: string;
    TOKEN_VAULT_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    MICROSOFT_CLIENT_ID?: string;
    MICROSOFT_CLIENT_SECRET?: string;
  }
}
