import { z } from 'zod';

const boolEnv = (def: boolean) =>
  z.preprocess((v) => (typeof v === 'string' ? ['true', '1', 'yes'].includes(v.toLowerCase()) : v), z.boolean().default(def));

const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./.data/storage'),
    S3_ENDPOINT: optionalString,
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY: optionalString,
    S3_SECRET_KEY: optionalString,
    S3_FORCE_PATH_STYLE: boolEnv(false),
    GOOGLE_BOOKS_API_KEY: optionalString,
    OPENLIBRARY_USER_AGENT: z.string().default('bookstall/1.0 (set-OPENLIBRARY_USER_AGENT)'),
    /** Override only for tests / a self-hosted mirror. */
    OPENLIBRARY_BASE_URL: z.string().url().default('https://openlibrary.org'),
    GOOGLE_BOOKS_BASE_URL: z.string().url().default('https://www.googleapis.com/books/v1/volumes'),
    EXTERNAL_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    SEED_ADMIN_USERNAME: optionalString,
    SEED_ADMIN_PASSWORD: optionalString,
    LOG_LEVEL: z.string().default('info'),
    SENTRY_DSN: optionalString,
    ENABLE_DOCS: boolEnv(false),
    RATE_LIMIT_ENABLED: boolEnv(true),
    /** 'pgboss' in production; 'memory' keeps jobs in-process (tests). */
    JOBS_MODE: z.enum(['pgboss', 'memory']).default('pgboss'),
    /** Minimum gap between calls to one external provider (Open Library / Google Books). */
    EXTERNAL_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
    /** Test-only: lets the cover fetcher reach loopback addresses. Never enable in production. */
    ALLOW_PRIVATE_FETCH: boolEnv(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.JWT_ACCESS_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'required in production' });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when STORAGE_DRIVER=s3' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses and validates the environment. Throws a readable error so the process refuses to boot. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
