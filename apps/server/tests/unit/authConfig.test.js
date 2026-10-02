import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config/env.js'
import { parseDuration } from '../../src/utils/duration.js'

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/realtime_chat',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: randomBytes(48).toString('hex'),
}

// Production requires https client origins.
const production = {
  NODE_ENV: 'production',
  CLIENT_ORIGIN: 'https://chat.example.com',
}

function issues(env) {
  try {
    loadConfig({ ...base, ...env })
  } catch (error) {
    return error.issues
  }
  return []
}

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['7d', 604_800_000],
    [' 2h ', 7_200_000],
  ])('parses %s', (input, ms) => {
    expect(parseDuration(input)).toBe(ms)
  })

  it.each(['', '0s', '15', 'm', '1.5h', '-1h', '1w', '1 h'])(
    'rejects %s',
    (input) => {
      expect(parseDuration(input)).toBeNull()
    },
  )
})

describe('authentication configuration', () => {
  it('requires JWT_SECRET', () => {
    expect(issues({ JWT_SECRET: undefined })).toContain(
      'JWT_SECRET: is required',
    )
  })

  it('requires a JWT_SECRET of at least 32 characters', () => {
    expect(issues({ JWT_SECRET: 'too-short-secret' })).toEqual([
      'JWT_SECRET: must be at least 32 characters',
    ])
  })

  it('refuses the .env.example placeholder secret', () => {
    expect(issues({ JWT_SECRET: 'replace-with-a-long-random-secret' })).toEqual(
      [
        'JWT_SECRET: must be replaced with a real random secret (it still holds the example placeholder)',
      ],
    )
  })

  it('never echoes the secret in configuration errors', () => {
    const secret = `${'s'.repeat(20)}`
    const error = (() => {
      try {
        loadConfig({ ...base, JWT_SECRET: secret })
      } catch (err) {
        return err
      }
    })()
    expect(error.message).not.toContain(secret)
  })

  it('parses token lifetime and session maximum age', () => {
    const { auth } = loadConfig({
      ...base,
      JWT_EXPIRES_IN: '15m',
      SESSION_MAX_AGE: '1d',
    })
    expect(auth.tokenTtlMs).toBe(900_000)
    expect(auth.sessionMaxAgeMs).toBe(86_400_000)
  })

  it.each([
    [{ JWT_EXPIRES_IN: 'forever' }, 'JWT_EXPIRES_IN: must be a duration'],
    [{ SESSION_MAX_AGE: '10' }, 'SESSION_MAX_AGE: must be a duration'],
    [
      { JWT_EXPIRES_IN: '2d', SESSION_MAX_AGE: '1d' },
      'SESSION_MAX_AGE: must be greater than or equal to JWT_EXPIRES_IN',
    ],
    [
      { AUTH_COOKIE_SECURE: 'yes' },
      'AUTH_COOKIE_SECURE: must be true or false',
    ],
    [
      { AUTH_COOKIE_SAMESITE: 'lenient' },
      'AUTH_COOKIE_SAMESITE: must be one of',
    ],
    [{ AUTH_RATE_LIMIT_MAX: '0' }, 'AUTH_RATE_LIMIT_MAX: must be positive'],
  ])('rejects %o', (env, expected) => {
    expect(issues(env).join('\n')).toContain(expected)
  })

  it('uses non-Secure cookies by default outside production', () => {
    expect(loadConfig(base).auth.cookieSecure).toBe(false)
  })

  it('uses Secure cookies by default in production', () => {
    expect(loadConfig({ ...base, ...production }).auth.cookieSecure).toBe(true)
  })

  it('refuses non-Secure cookies in production', () => {
    expect(issues({ ...production, AUTH_COOKIE_SECURE: 'false' })).toEqual([
      'AUTH_COOKIE_SECURE: must not be false in production (cookies must be Secure)',
    ])
  })

  it('allows opting into Secure cookies in development', () => {
    expect(
      loadConfig({ ...base, AUTH_COOKIE_SECURE: 'true' }).auth.cookieSecure,
    ).toBe(true)
  })

  it('requires Secure cookies for SameSite=None', () => {
    expect(issues({ AUTH_COOKIE_SAMESITE: 'none' })).toEqual([
      'AUTH_COOKIE_SAMESITE: none requires AUTH_COOKIE_SECURE=true',
    ])
    expect(
      issues({ AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_SECURE: 'true' }),
    ).toEqual([])
  })
})

describe('production and proxy configuration', () => {
  it('requires https client origins in production', () => {
    expect(
      issues({
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'http://chat.example.com',
      }),
    ).toEqual(['CLIENT_ORIGIN: must use https:// origins in production'])
    expect(
      issues({
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'https://a.example.com,http://b.example.com',
      }),
    ).toEqual(['CLIENT_ORIGIN: must use https:// origins in production'])
    expect(issues(production)).toEqual([])
  })

  it('allows http origins outside production', () => {
    expect(issues({ CLIENT_ORIGIN: 'http://localhost:5173' })).toEqual([])
  })

  it('parses TRUST_PROXY hops (default 0)', () => {
    expect(loadConfig(base).trustProxy).toBe(0)
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2)
    for (const value of ['-1', '11', 'yes', '1.5']) {
      expect(issues({ TRUST_PROXY: value }).join()).toMatch(/^TRUST_PROXY: /)
    }
  })
})
