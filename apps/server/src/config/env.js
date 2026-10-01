import { z } from 'zod'
import { parseDuration } from '../utils/duration.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug']
const MIN_JWT_SECRET_LENGTH = 32
// The value shipped in .env.example must never be used as a real secret.
const PLACEHOLDER_SECRET = /replace-with|change-?me|placeholder/i

export class ConfigError extends Error {
  constructor(issues) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    )
    this.name = 'ConfigError'
    this.issues = issues
  }
}

const required = (message) => ({
  error: (issue) => (issue.input === undefined ? 'is required' : message),
})

/**
 * Extracts the host names from a MongoDB connection string without ever
 * returning credentials. Returns null for strings that are not mongodb URIs.
 */
export function parseMongoHosts(uri) {
  const match = /^mongodb(\+srv)?:\/\/([^/?]*)/.exec(uri)
  if (!match) return null
  const authority = match[2]
  const hostList = authority.slice(authority.lastIndexOf('@') + 1)
  if (!hostList) return null
  return hostList.split(',').map((host) => {
    const bracketed = /^\[([^\]]+)\]/.exec(host)
    if (bracketed) return bracketed[1]
    return host.split(':')[0].toLowerCase()
  })
}

function parseOrigins(value, ctx) {
  const origins = value
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
  if (origins.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'is required' })
    return z.NEVER
  }
  for (const origin of origins) {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      parsed = null
    }
    if (
      !parsed ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `contains an invalid origin "${origin}" (expected e.g. https://chat.example.com)`,
      })
      return z.NEVER
    }
  }
  return origins
}

const durationSchema = z
  .string({ error: 'must be a string' })
  .transform((value, ctx) => {
    const ms = parseDuration(value)
    if (ms === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be a duration such as 30s, 15m, 1h or 7d',
      })
      return z.NEVER
    }
    return ms
  })

const envShape = {
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'must be one of development, test, production',
    })
    .default('development'),
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(0, 'must be between 0 and 65535')
    .max(65535, 'must be between 0 and 65535')
    .default(5000),
  MONGODB_URI: z
    .string(required('must be a string'))
    .refine(
      (uri) => parseMongoHosts(uri) !== null,
      'must be a mongodb:// or mongodb+srv:// connection string',
    ),
  CLIENT_ORIGIN: z.string(required('must be a string')).transform(parseOrigins),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .positive('must be positive')
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .positive('must be positive')
    .default(300),
  JWT_SECRET: z
    .string(required('must be a string'))
    .min(
      MIN_JWT_SECRET_LENGTH,
      `must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    )
    .refine(
      (secret) => !PLACEHOLDER_SECRET.test(secret),
      'must be replaced with a real random secret (it still holds the example placeholder)',
    ),
  JWT_EXPIRES_IN: durationSchema.prefault('1h'),
  SESSION_MAX_AGE: durationSchema.prefault('7d'),
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'], { error: 'must be true or false' })
    .optional(),
  AUTH_COOKIE_SAMESITE: z
    .enum(['lax', 'strict', 'none'], {
      error: 'must be one of lax, strict, none',
    })
    .default('lax'),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .positive('must be positive')
    .default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .positive('must be positive')
    .default(10),
}

function cookieSecure(env) {
  return env.AUTH_COOKIE_SECURE === undefined
    ? env.NODE_ENV === 'production'
    : env.AUTH_COOKIE_SECURE === 'true'
}

const envSchema = z.object(envShape).superRefine((env, ctx) => {
  // Hard guard: automated tests may only ever talk to a local database.
  if (env.NODE_ENV === 'test' && env.MONGODB_URI) {
    const hosts = parseMongoHosts(env.MONGODB_URI)
    if (
      env.MONGODB_URI.startsWith('mongodb+srv:') ||
      !hosts?.every((host) => LOOPBACK_HOSTS.has(host))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message:
          'must point at a loopback host (localhost/127.0.0.1) when NODE_ENV=test',
      })
    }
  }

  if (env.NODE_ENV === 'production' && !cookieSecure(env)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_COOKIE_SECURE'],
      message: 'must not be false in production (cookies must be Secure)',
    })
  }
  if (env.AUTH_COOKIE_SAMESITE === 'none' && !cookieSecure(env)) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_COOKIE_SAMESITE'],
      message: 'none requires AUTH_COOKIE_SECURE=true',
    })
  }
  if (
    env.JWT_EXPIRES_IN &&
    env.SESSION_MAX_AGE &&
    env.SESSION_MAX_AGE < env.JWT_EXPIRES_IN
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['SESSION_MAX_AGE'],
      message: 'must be greater than or equal to JWT_EXPIRES_IN',
    })
  }
})

/**
 * Validates environment variables and returns a frozen config object.
 * Throws ConfigError listing every problem. Values are never echoed back in
 * error messages because they may contain credentials.
 */
export function loadConfig(env = process.env) {
  const input = Object.fromEntries(
    Object.keys(envShape).map((key) => [
      key,
      env[key]?.trim() === '' ? undefined : env[key]?.trim(),
    ]),
  )
  const result = envSchema.safeParse(input)
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`,
      ),
    )
  }

  const parsed = result.data
  return Object.freeze({
    env: parsed.NODE_ENV,
    isProduction: parsed.NODE_ENV === 'production',
    isTest: parsed.NODE_ENV === 'test',
    port: parsed.PORT,
    mongodbUri: parsed.MONGODB_URI,
    clientOrigins: Object.freeze(parsed.CLIENT_ORIGIN),
    logLevel:
      parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    rateLimit: Object.freeze({
      windowMs: parsed.RATE_LIMIT_WINDOW_MS,
      max: parsed.RATE_LIMIT_MAX,
    }),
    auth: Object.freeze({
      jwtSecret: parsed.JWT_SECRET,
      tokenTtlMs: parsed.JWT_EXPIRES_IN,
      sessionMaxAgeMs: parsed.SESSION_MAX_AGE,
      cookieSecure: cookieSecure(parsed),
      cookieSameSite: parsed.AUTH_COOKIE_SAMESITE,
      rateLimit: Object.freeze({
        windowMs: parsed.AUTH_RATE_LIMIT_WINDOW_MS,
        max: parsed.AUTH_RATE_LIMIT_MAX,
      }),
    }),
  })
}
