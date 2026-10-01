import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createAuthenticate } from '../../src/middleware/authenticate.js'
import { authorize } from '../../src/middleware/authorize.js'
import { errorHandler } from '../../src/middleware/errorHandler.js'
import { requireAllowedOrigin } from '../../src/middleware/requireAllowedOrigin.js'
import { AppError } from '../../src/utils/AppError.js'
import { createAuthCookie } from '../../src/utils/authCookie.js'
import { silentLogger, TEST_ORIGIN } from '../helpers/testEnv.js'

const authCookie = createAuthCookie({
  cookieSecure: false,
  cookieSameSite: 'lax',
})
const alice = { _id: 'a1', name: 'Alice' }

function serviceReturning(result) {
  return {
    authenticate: vi.fn(async (token) => {
      if (result instanceof Error) throw result
      return {
        claims: { sessionId: `sid-for-${token}` },
        renewal: null,
        ...result,
      }
    }),
  }
}

function appWith(authService, ...extra) {
  const app = express()
  app.use(express.json())
  app.post(
    '/protected',
    createAuthenticate({ authService, authCookie }),
    ...extra,
    (req, res) =>
      res.json({
        auth: { userId: req.auth.userId, sessionId: req.auth.sessionId },
      }),
  )
  app.use(errorHandler(silentLogger))
  return app
}

describe('authenticate middleware', () => {
  it('rejects requests without a session cookie', async () => {
    const service = serviceReturning({ user: alice })
    const res = await request(appWith(service)).post('/protected')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED')
    expect(service.authenticate).not.toHaveBeenCalled()
  })

  it('ignores credentials sent anywhere other than the cookie', async () => {
    const service = serviceReturning({ user: alice })
    const res = await request(appWith(service))
      .post('/protected')
      .set('Authorization', 'Bearer some.jwt.value')
      .send({ token: 'x', userId: 'a1' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('attaches identity from the verified session only', async () => {
    const service = serviceReturning({ user: alice })
    const res = await request(appWith(service))
      .post('/protected?userId=evil')
      .set('Cookie', 'rtc_session=tok123')
      .send({ userId: 'evil', _id: 'evil' })
    expect(res.status).toBe(200)
    expect(res.body.auth).toEqual({ userId: 'a1', sessionId: 'sid-for-tok123' })
    expect(service.authenticate).toHaveBeenCalledWith('tok123')
  })

  it('rejects an invalid session and clears the cookie', async () => {
    const service = serviceReturning(
      new AppError(
        401,
        'AUTHENTICATION_INVALID',
        'Authentication is invalid or has expired',
      ),
    )
    const res = await request(appWith(service))
      .post('/protected')
      .set('Cookie', 'rtc_session=bad')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_INVALID')
    expect(res.headers['set-cookie'][0]).toMatch(
      /^rtc_session=; .*Expires=Thu, 01 Jan 1970/,
    )
  })

  it('does not clear the cookie on unexpected (non-auth) failures', async () => {
    const service = serviceReturning(new Error('database down'))
    const res = await request(appWith(service))
      .post('/protected')
      .set('Cookie', 'rtc_session=tok')
    expect(res.status).toBe(500)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('sets a renewed cookie when the session slides', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000)
    const service = serviceReturning({
      user: alice,
      renewal: { token: 'renewed-token', expiresAt },
    })
    const res = await request(appWith(service))
      .post('/protected')
      .set('Cookie', 'rtc_session=old')
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie'][0]).toContain('rtc_session=renewed-token;')
  })
})

describe('authorize middleware', () => {
  const okService = serviceReturning({ user: alice })

  it('allows the request when the policy passes', async () => {
    const policy = vi.fn(async (req) => req.auth.userId === 'a1')
    const res = await request(appWith(okService, authorize(policy)))
      .post('/protected')
      .set('Cookie', 'rtc_session=t')
    expect(res.status).toBe(200)
    expect(policy).toHaveBeenCalledOnce()
  })

  it('returns 403 FORBIDDEN when the policy fails', async () => {
    const res = await request(
      appWith(
        okService,
        authorize(() => false),
      ),
    )
      .post('/protected')
      .set('Cookie', 'rtc_session=t')
    expect(res.status).toBe(403)
    expect(res.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'Not authorized',
    })
  })

  it('requires authentication to have run first', async () => {
    const app = express()
    app.get(
      '/x',
      authorize(() => true),
      (_req, res) => res.json({ ok: true }),
    )
    app.use(errorHandler(silentLogger))
    const res = await request(app).get('/x')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })
})

describe('requireAllowedOrigin (CSRF defence)', () => {
  function originApp() {
    const app = express()
    app.use(requireAllowedOrigin([TEST_ORIGIN]))
    app.all('/x', (_req, res) => res.json({ ok: true }))
    app.use(errorHandler(silentLogger))
    return app
  }

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects %s from a foreign origin',
    async (method) => {
      const agent = request(originApp())
      const res = await agent[method.toLowerCase()]('/x').set(
        'Origin',
        'https://evil.example.com',
      )
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    },
  )

  it('rejects the opaque "null" origin', async () => {
    const res = await request(originApp()).post('/x').set('Origin', 'null')
    expect(res.status).toBe(403)
  })

  it('allows unsafe methods from the configured client origin', async () => {
    await request(originApp()).post('/x').set('Origin', TEST_ORIGIN).expect(200)
  })

  it('allows requests without an Origin header (non-browser clients)', async () => {
    await request(originApp()).post('/x').expect(200)
  })

  it('does not block safe methods', async () => {
    await request(originApp())
      .get('/x')
      .set('Origin', 'https://evil.example.com')
      .expect(200)
  })
})

describe('auth cookie', () => {
  it('is HttpOnly, SameSite and host-scoped', () => {
    const res = { cookie: vi.fn() }
    const expires = new Date()
    authCookie.set(res, 'tok', expires)
    expect(res.cookie).toHaveBeenCalledWith('rtc_session', 'tok', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      expires,
    })
  })

  it('uses the __Host- prefix and Secure when secure', () => {
    const secure = createAuthCookie({
      cookieSecure: true,
      cookieSameSite: 'strict',
    })
    const res = { cookie: vi.fn() }
    secure.set(res, 'tok', new Date())
    expect(secure.name).toBe('__Host-rtc_session')
    expect(res.cookie.mock.calls[0][2]).toMatchObject({
      secure: true,
      sameSite: 'strict',
      path: '/',
      httpOnly: true,
    })
    expect(res.cookie.mock.calls[0][2]).not.toHaveProperty('domain')
  })

  it('reads only its own cookie from a Cookie header', () => {
    expect(authCookie.read('a=1; rtc_session=tok; b=2')).toBe('tok')
    expect(authCookie.read('__Host-rtc_session=x')).toBeUndefined()
    expect(authCookie.read('rtc_session=')).toBeUndefined()
    expect(authCookie.read(undefined)).toBeUndefined()
  })
})
