import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';

const pem = z.string().transform((v) => v.replace(/\\n/g, '\n'));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** 'json' for machines (default, and what containers ship); 'pretty' for a local terminal. */
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    WEB_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((o) => o.trim())),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),

    /** ES256 key pair of the (simulated) identity provider. Generated per boot outside production. */
    JWT_PRIVATE_KEY: pem.optional(),
    JWT_PUBLIC_KEY: pem.optional(),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    /** Shared secret for payment-provider webhook signatures. */
    WEBHOOK_SECRET: z.string().min(32),
    WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

    /** Credit limit as a share of confirmed collateral (10_000 bps = 100%). */
    ADVANCE_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(10_000),
    MIN_DEPOSIT_MINOR: z.coerce.bigint().positive().default(5_000n),
    MAX_DEPOSIT_MINOR: z.coerce.bigint().positive().default(1_000_000n),

    /** Enables the payment simulator endpoints. Never in production. */
    SANDBOX_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_PRIVATE_KEY'],
          message: 'required in production',
        });
      }
      if (env.SANDBOX_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['SANDBOX_ENABLED'],
          message: 'must be false in production',
        });
      }
    }
    if (env.MIN_DEPOSIT_MINOR > env.MAX_DEPOSIT_MINOR) {
      ctx.addIssue({
        code: 'custom',
        path: ['MIN_DEPOSIT_MINOR'],
        message: 'must be <= MAX_DEPOSIT_MINOR',
      });
    }
  });

export type Env = Omit<z.infer<typeof envSchema>, 'JWT_PRIVATE_KEY' | 'JWT_PUBLIC_KEY'> & {
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
};

export const ENV = Symbol('ENV');

/**
 * Validates configuration once at boot. A lending service must refuse to start
 * on bad config rather than run with surprising defaults.
 */
export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const { JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, ...rest } = parsed.data;
  if (JWT_PRIVATE_KEY && JWT_PUBLIC_KEY) {
    return { ...rest, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY };
  }
  const pair = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { ...rest, JWT_PRIVATE_KEY: pair.privateKey, JWT_PUBLIC_KEY: pair.publicKey };
}
