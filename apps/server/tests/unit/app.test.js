import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { createReadinessService } from '../../src/services/readiness.service.js'
import {
  silentLogger,
  TEST_ORIGIN,
  testConfig,
  unusedAuth,
  unusedChat,
} from '../helpers/testEnv.js'

function buildApp({ checks = { database: async () => {} }, config } = {}) {
  const appConfig = config ?? testConfig()
  return createApp({
    config: appConfig,
    logger: silentLogger,
    readiness: createReadinessService(checks, { timeoutMs: 50 }),
    auth: unusedAuth(appConfig),
    chat: unusedChat(),
  })
}

describe.each(['', '/api'])('probes under "%s"', (prefix) => {
  it('GET /health reports liveness', async () => {
    const res = await request(buildApp()).get(`${prefix}/health`)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({
      success: true,
      data: {
        status: 'ok',
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String),
      },
    })
  })

  it('GET /health does not depend on the database', async () => {
    const app = buildApp({
      checks: {
        database: async () => {
          throw new Error('down')
        },
      },
    })
    const res = await request(app).get(`${prefix}/health`)
    expect(res.status).toBe(200)
  })

  it('GET /ready returns 200 when dependencies are up', async () => {
    const res = await request(buildApp()).get(`${prefix}/ready`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ready', checks: { database: 'up' } },
    })
  })

  it('GET /ready returns 503 when the database check fails', async () => {
    const app = buildApp({
      checks: {
        database: async () => {
          throw new Error('connection refused to db.internal:27017')
        },
      },
    })
    const res = await request(app).get(`${prefix}/ready`)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_READY',
        message: 'Service is not ready',
        details: [{ check: 'database', status: 'down' }],
      },
    })
    expect(JSON.stringify(res.body)).not.toContain('db.internal')
  })

  it('GET /ready returns 503 when the database check hangs', async () => {
    const app = buildApp({ checks: { database: () => new Promise(() => {}) } })
    const res = await request(app).get(`${prefix}/ready`)
    expect(res.status).toBe(503)
  })
})

describe('security baseline', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(buildApp()).get('/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    )
    expect(res.headers['strict-transport-security']).toBeDefined()
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
  })

  it('allows CORS for the configured client origin', async () => {
    const res = await request(buildApp())
      .get('/api/health')
      .set('Origin', TEST_ORIGIN)
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('answers CORS preflight for the configured origin', async () => {
    const res = await request(buildApp())
      .options('/api/health')
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN)
  })

  it('does not grant CORS to other origins', async () => {
    const res = await request(buildApp())
      .get('/api/health')
      .set('Origin', 'https://evil.example.com')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('generates a request id', async () => {
    const res = await request(buildApp()).get('/health')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('propagates a well-formed inbound request id', async () => {
    const res = await request(buildApp())
      .get('/health')
      .set('X-Request-Id', 'edge-123.abc')
    expect(res.headers['x-request-id']).toBe('edge-123.abc')
  })

  it('replaces a malformed inbound request id', async () => {
    const res = await request(buildApp())
      .get('/health')
      .set('X-Request-Id', 'bad id\twith spaces')
    expect(res.headers['x-request-id']).not.toContain('bad id')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('fallback handling', () => {
  it('returns a 404 envelope for unknown routes', async () => {
    const res = await request(buildApp()).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    })
  })

  it('rejects malformed JSON bodies with 400', async () => {
    const res = await request(buildApp())
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })

  it('rejects bodies over the size limit with 413', async () => {
    const res = await request(buildApp())
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(150 * 1024) }))
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

describe('API rate limiting', () => {
  const limitedConfig = () =>
    testConfig({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' })

  it('returns 429 with an error envelope once the limit is exceeded', async () => {
    const app = buildApp({ config: limitedConfig() })
    await request(app).get('/api/x').expect(404)
    await request(app).get('/api/x').expect(404)
    const res = await request(app).get('/api/x')
    expect(res.status).toBe(429)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    })
    expect(res.headers['ratelimit-policy']).toBeDefined()
  })

  it('never rate limits health probes', async () => {
    const app = buildApp({ config: limitedConfig() })
    for (let i = 0; i < 5; i += 1) {
      await request(app).get('/api/health').expect(200)
      await request(app).get('/ready').expect(200)
    }
  })
})
