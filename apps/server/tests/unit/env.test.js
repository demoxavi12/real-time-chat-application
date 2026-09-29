import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  loadConfig,
  parseMongoHosts,
} from '../../src/config/env.js'

const validEnv = {
  MONGODB_URI: 'mongodb://localhost:27017/realtime_chat',
  CLIENT_ORIGIN: 'http://localhost:5173',
}

function configError(env) {
  try {
    loadConfig(env)
  } catch (error) {
    return error
  }
  throw new Error('expected loadConfig to throw')
}

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    const config = loadConfig(validEnv)
    expect(config).toMatchObject({
      env: 'development',
      isProduction: false,
      isTest: false,
      port: 5000,
      mongodbUri: validEnv.MONGODB_URI,
      clientOrigins: ['http://localhost:5173'],
      logLevel: 'info',
      rateLimit: { windowMs: 900_000, max: 300 },
    })
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('parses explicit values', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX: '10',
    })
    expect(config).toMatchObject({
      env: 'production',
      isProduction: true,
      port: 8080,
      logLevel: 'warn',
      rateLimit: { windowMs: 60_000, max: 10 },
    })
  })

  it('is silent by default under NODE_ENV=test', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/x_test',
    })
    expect(config.logLevel).toBe('silent')
  })

  it('reports every missing required variable at once', () => {
    const error = configError({})
    expect(error).toBeInstanceOf(ConfigError)
    expect(error.issues).toEqual([
      'MONGODB_URI: is required',
      'CLIENT_ORIGIN: is required',
    ])
    expect(error.message).toContain('Invalid environment configuration')
  })

  it('treats blank values as missing', () => {
    const error = configError({ MONGODB_URI: '   ', CLIENT_ORIGIN: '' })
    expect(error.issues).toEqual([
      'MONGODB_URI: is required',
      'CLIENT_ORIGIN: is required',
    ])
  })

  it.each([
    [{ PORT: 'abc' }, 'PORT: must be a number'],
    [{ PORT: '70000' }, 'PORT: must be between 0 and 65535'],
    [{ NODE_ENV: 'staging' }, 'NODE_ENV: must be one of'],
    [{ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL: must be one of'],
    [{ RATE_LIMIT_MAX: '0' }, 'RATE_LIMIT_MAX: must be positive'],
    [{ MONGODB_URI: 'postgres://x' }, 'MONGODB_URI: must be a mongodb://'],
    [{ CLIENT_ORIGIN: '*' }, 'CLIENT_ORIGIN: contains an invalid origin'],
    [
      { CLIENT_ORIGIN: 'http://localhost:5173/app' },
      'CLIENT_ORIGIN: contains an invalid origin',
    ],
  ])('rejects invalid value %o', (override, expected) => {
    const error = configError({ ...validEnv, ...override })
    expect(error.issues.join('\n')).toContain(expected)
  })

  it('accepts a comma-separated list of origins', () => {
    const config = loadConfig({
      ...validEnv,
      CLIENT_ORIGIN: 'https://chat.example.com, http://localhost:5173/',
    })
    expect(config.clientOrigins).toEqual([
      'https://chat.example.com',
      'http://localhost:5173',
    ])
  })

  it('never echoes the MongoDB URI (which may hold credentials) in errors', () => {
    const secretUri = 'mongodb+srv://admin:s3cr3tP4ss@cluster0.example.net/db' // secret-scan:allow (fake fixture)
    const error = configError({
      NODE_ENV: 'test',
      MONGODB_URI: secretUri,
      CLIENT_ORIGIN: 'nope',
    })
    expect(error.message).not.toContain('s3cr3tP4ss')
    expect(error.message).not.toContain(secretUri)
  })

  describe('test database guard', () => {
    it.each([
      'mongodb://127.0.0.1:27017/chat_test',
      'mongodb://localhost:27017/chat_test',
      'mongodb://[::1]:27017/chat_test',
      'mongodb://user:pw@127.0.0.1:27017,localhost:27018/chat_test', // secret-scan:allow (fake fixture)
    ])('allows loopback URI %s under NODE_ENV=test', (uri) => {
      expect(() =>
        loadConfig({ ...validEnv, NODE_ENV: 'test', MONGODB_URI: uri }),
      ).not.toThrow()
    })

    it.each([
      'mongodb://db.example.com:27017/chat',
      'mongodb+srv://cluster0.example.net/chat',
      'mongodb://127.0.0.1:27017,db.example.com:27017/chat',
    ])('refuses non-loopback URI %s under NODE_ENV=test', (uri) => {
      const error = configError({
        ...validEnv,
        NODE_ENV: 'test',
        MONGODB_URI: uri,
      })
      expect(error.issues).toEqual([
        'MONGODB_URI: must point at a loopback host (localhost/127.0.0.1) when NODE_ENV=test',
      ])
    })

    it('does not restrict hosts outside the test environment', () => {
      expect(() =>
        loadConfig({
          ...validEnv,
          NODE_ENV: 'production',
          MONGODB_URI: 'mongodb+srv://cluster0.example.net/chat',
        }),
      ).not.toThrow()
    })
  })
})

describe('parseMongoHosts', () => {
  it('extracts hosts without credentials', () => {
    expect(
      parseMongoHosts('mongodb://u:p@Host1:1,host2:2/db?authSource=admin'), // secret-scan:allow (fake fixture)
    ).toEqual(['host1', 'host2'])
  })

  it('handles passwords containing @', () => {
    const uri = 'mongodb://u:p@ss@localhost/db' // secret-scan:allow (fake fixture)
    expect(parseMongoHosts(uri)).toEqual(['localhost'])
  })

  it('returns null for non-mongodb strings', () => {
    expect(parseMongoHosts('http://localhost')).toBeNull()
    expect(parseMongoHosts('mongodb://')).toBeNull()
  })
})
