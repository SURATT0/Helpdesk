import dotenv from "dotenv";

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";

// The dev-only secret fallbacks below. Handy for `npm run dev` with no .env,
// but a liability if they ever reach a shared/prod deployment — `validateEnv()`
// refuses to boot in production if any of these values survives.
export const DEV_DEFAULT_ACCESS_SECRET = "dev-access-secret-change-me";
export const DEV_DEFAULT_REFRESH_SECRET = "dev-refresh-secret-change-me";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  logLevel:
    process.env.LOG_LEVEL ?? (nodeEnv === "production" ? "info" : "debug"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3",
  localStorageDir: process.env.LOCAL_STORAGE_DIR ?? "./.uploads",
  // S3 storage (STORAGE_DRIVER=s3). `s3Endpoint` + `s3ForcePathStyle` target an
  // S3-compatible server like MinIO; leave them unset for real AWS S3, where the
  // default credential chain (IAM role / env / profile) supplies credentials.
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Endpoint: process.env.S3_ENDPOINT || undefined,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
  // Optional public base URL for building object URLs (e.g. a CDN in front of
  // the bucket). Falls back to a synthetic `s3://bucket/key` reference.
  s3PublicUrl: process.env.S3_PUBLIC_URL || undefined,
  // Auth. Access token is short-lived (memory-only on the client); refresh
  // token is long-lived and rotated. Dev defaults are for local use only —
  // set strong secrets via env in any shared/prod environment.
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? DEV_DEFAULT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? DEV_DEFAULT_REFRESH_SECRET,
  accessTtlSec: Number(process.env.ACCESS_TTL_SEC ?? 15 * 60), // 15 min
  refreshTtlSec: Number(process.env.REFRESH_TTL_SEC ?? 7 * 24 * 60 * 60), // 7 d
  // Whether the refresh cookie gets the `Secure` flag. Decoupled from NODE_ENV
  // because a browser drops `Secure` cookies received over plain HTTP — so a
  // prod-mode stack served without TLS (e.g. docker-compose) must set this
  // false. Defaults to on in production; put TLS in front and leave it true.
  cookieSecure:
    process.env.COOKIE_SECURE != null
      ? process.env.COOKIE_SECURE === "true"
      : nodeEnv === "production",
  // Max login attempts per IP per 15-min window (brute-force guard). Raised in
  // the integration-test config so the suite's many logins don't trip it.
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 20),
  // Background sweep that closes tickets left resolved > 72h. Set AUTO_CLOSE=false to disable.
  autoClose: process.env.AUTO_CLOSE !== "false",
  // Log aggregation. Structured JSON always goes to stdout (the baseline any
  // infra log shipper scrapes); when LOKI_URL is set the logger ALSO ships to a
  // Grafana Loki endpoint (`/loki/api/v1/push`). Basic-auth creds are optional
  // (e.g. Grafana Cloud). Unset → stdout only, no behaviour change.
  lokiUrl: process.env.LOKI_URL || undefined,
  lokiUsername: process.env.LOKI_USERNAME || undefined,
  lokiPassword: process.env.LOKI_PASSWORD || undefined,
  // Real-time event bus. Unset → in-process (single node). Set to a Redis URL to
  // fan out SSE events across multiple API instances via Redis pub/sub.
  redisUrl: process.env.REDIS_URL || undefined,
  // External ticket sources (future integrations). Each provider is a pluggable
  // adapter (see src/modules/integrations); leaving these unset marks the
  // provider "not configured" without affecting anything else. The real REST
  // calls are stubbed until wired up — see the provider files.
  integrations: {
    jira: {
      baseUrl: process.env.JIRA_BASE_URL || undefined,
      email: process.env.JIRA_EMAIL || undefined,
      apiToken: process.env.JIRA_API_TOKEN || undefined,
      jql: process.env.JIRA_JQL || undefined,
    },
    zendesk: {
      subdomain: process.env.ZENDESK_SUBDOMAIN || undefined,
      email: process.env.ZENDESK_EMAIL || undefined,
      apiToken: process.env.ZENDESK_API_TOKEN || undefined,
    },
    // Email-to-ticket. The inbound webhook is enabled only when a secret is set
    // (providers must present it). Unknown senders become `requester` users
    // automatically unless disabled. `defaultCategory` names the category new
    // email tickets land in (falls back to the first category if unset/unknown).
    email: {
      webhookSecret: process.env.EMAIL_WEBHOOK_SECRET || undefined,
      defaultCategory: process.env.EMAIL_DEFAULT_CATEGORY || undefined,
      createUnknownRequester:
        process.env.EMAIL_CREATE_UNKNOWN_REQUESTER !== "false",
    },
    // IMAP inbox polling (pull model). Adapter is scaffolded; unset = "not
    // configured". When implemented it routes messages through the same
    // email-to-ticket ingestion the webhook uses.
    imap: {
      host: process.env.IMAP_HOST || undefined,
      port: Number(process.env.IMAP_PORT ?? 993),
      user: process.env.IMAP_USER || undefined,
      password: process.env.IMAP_PASSWORD || undefined,
      tls: process.env.IMAP_TLS !== "false",
    },
  },
  // Outbound SMTP for agent reply emails. When SMTP_HOST is set the reply
  // endpoint sends real mail via nodemailer; otherwise a "log" transport records
  // the message (so the feature works end-to-end in dev without a mail server).
  smtp: {
    host: process.env.SMTP_HOST || undefined,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    // Envelope From for outbound mail (falls back to the agent's address).
    from: process.env.SMTP_FROM || undefined,
  },
};

export const API_PREFIX = "/api/v1";

/** Minimum length for a production JWT secret (≈256 bits of random base64). */
const MIN_SECRET_LENGTH = 32;

const DEV_DEFAULT_SECRETS = new Set<string>([
  DEV_DEFAULT_ACCESS_SECRET,
  DEV_DEFAULT_REFRESH_SECRET,
]);

/**
 * Fail-fast configuration guard, run once at boot (before the server listens).
 *
 * DATABASE_URL is required everywhere (there is no sensible default). In
 * production we additionally refuse to start on weak or default auth secrets —
 * catching the classic "shipped the dev secret" mistake at boot instead of
 * silently signing forgeable tokens. Non-fatal risks (e.g. a Secure-less cookie
 * in prod) are returned as warnings for the caller to log. Never logs secret
 * values — only the names of the offending variables.
 */
export function validateEnv(): { warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const isProd = env.nodeEnv === "production";

  if (!env.databaseUrl) {
    problems.push("DATABASE_URL is required but is not set");
  }

  if (env.storageDriver === "s3") {
    if (!env.s3Bucket) {
      problems.push("S3_BUCKET is required when STORAGE_DRIVER=s3");
    }
    // A custom endpoint (MinIO / non-AWS) has no IAM-role credential chain, so
    // explicit keys are mandatory there. Real AWS S3 can rely on the default chain.
    if (env.s3Endpoint && (!env.s3AccessKeyId || !env.s3SecretAccessKey)) {
      problems.push(
        "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when S3_ENDPOINT is set",
      );
    }
  }

  const secrets: Array<[string, string]> = [
    ["JWT_ACCESS_SECRET", env.jwtAccessSecret],
    ["JWT_REFRESH_SECRET", env.jwtRefreshSecret],
  ];

  if (isProd) {
    for (const [name, value] of secrets) {
      if (!process.env[name]) {
        problems.push(`${name} must be set explicitly in production (no default is allowed)`);
      } else if (DEV_DEFAULT_SECRETS.has(value)) {
        problems.push(`${name} is set to a known dev default — generate a strong unique secret`);
      } else if (value.length < MIN_SECRET_LENGTH) {
        problems.push(
          `${name} must be at least ${MIN_SECRET_LENGTH} characters in production (got ${value.length})`,
        );
      }
    }
    if (env.jwtAccessSecret === env.jwtRefreshSecret) {
      problems.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values");
    }
    if (!env.cookieSecure) {
      warnings.push(
        "COOKIE_SECURE is false in production — the refresh cookie is sent without the Secure flag. Only acceptable if TLS terminates elsewhere and this stack is served over plain HTTP internally.",
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      ["Invalid environment configuration:", ...problems.map((p) => `  - ${p}`)].join("\n"),
    );
  }

  return { warnings };
}
