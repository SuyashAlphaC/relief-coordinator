declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    AUTH_MODE?: string;
    ACCESS_ISSUER?: string;
    ACCESS_AUD?: string;
    BUCKET?: R2Bucket;
  }
}
