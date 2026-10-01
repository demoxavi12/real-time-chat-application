import { randomBytes } from 'node:crypto'
import { UnsecuredJWT } from 'jose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/services/token.service.js'
import { buildUserInput, registerUser } from '../helpers/auth.js'
import { craftToken, startTestServer } from '../helpers/server.js'
import { TEST_ORIGIN, testJwtSecret } from '../helpers/testEnv.js'

let server
let url
let logLines

beforeAll(async () => {
  ;({ server, url, logLines } = await startTestServer())
})

afterAll(async () => {
  await server?.close()
})

const api = () => request(url)
const tokenOf = (cookie) => cookie.slice(cookie.indexOf('=') + 1)

describe('identity cannot be forged', () => {
  it('ignores user ids supplied in query, body or headers', async () => {
    const alice = await registerUser(url)
    const bob = await registerUser(url)
    const res = await api()
      .get(`/api/auth/me?userId=${bob.user.id}&id=${bob.user.id}`)
      .set('Cookie', alice.cookie)
      .set('X-User-Id', bob.user.id)
    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(alice.user.id)
  })

  it('rejects client-supplied _id / passwordHash / timestamps on registration', async () => {
    for (const field of [
      '_id',
      'passwordHash',
      'createdAt',
      'updatedAt',
      'id',
    ]) {
      const res = await api()
        .post('/api/auth/register')
        .send({ ...buildUserInput(), [field]: '65f000000000000000000099' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects a token whose payload was edited to impersonate another user', async () => {
    const alice = await registerUser(url)
    const bob = await registerUser(url)
    const [header, payload, signature] = tokenOf(alice.cookie).split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    claims.sub = bob.user.id
    const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`
    const res = await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${forged}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_INVALID')
  })

  it('rejects a token signed with another secret', async () => {
    const { user } = await registerUser(url)
    const token = await craftToken({
      sub: user.id,
      secret: randomBytes(48).toString('hex'),
    })
    await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${token}`)
      .expect(401)
  })

  it('rejects an unsigned alg:none token', async () => {
    const { user } = await registerUser(url)
    const now = Math.floor(Date.now() / 1000)
    const token = new UnsecuredJWT({ sid: 'x', auth_time: now })
      .setSubject(user.id)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .encode()
    await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${token}`)
      .expect(401)
  })

  it('rejects a token with the signature stripped', async () => {
    const { cookie } = await registerUser(url)
    const [header, payload] = tokenOf(cookie).split('.')
    await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${header}.${payload}.`)
      .expect(401)
  })

  it.each([
    ['missing', undefined],
    ['empty', 'rtc_session='],
    ['malformed', 'rtc_session=a.b.c'],
    ['random bytes', `rtc_session=${randomBytes(64).toString('base64url')}`],
  ])('rejects a %s token', async (_label, cookie) => {
    const req = api().get('/api/auth/me')
    if (cookie) req.set('Cookie', cookie)
    const res = await req
    expect(res.status).toBe(401)
    expect(['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_INVALID']).toContain(
      res.body.error.code,
    )
  })

  it('does not accept the token as a Bearer header', async () => {
    const { cookie } = await registerUser(url)
    const res = await api()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenOf(cookie)}`)
    expect(res.status).toBe(401)
  })
})

describe('no sensitive data leaks', () => {
  it('responses never contain hashes, tokens or the signing secret', async () => {
    const input = buildUserInput()
    const bodies = []
    const reg = await api().post('/api/auth/register').send(input)
    bodies.push(reg.text)
    const cookie = reg.headers['set-cookie'][0].split(';')[0]
    bodies.push((await api().get('/api/auth/me').set('Cookie', cookie)).text)
    bodies.push(
      (
        await api()
          .post('/api/auth/login')
          .send({ email: input.email, password: input.password })
      ).text,
    )
    bodies.push(
      (
        await api()
          .post('/api/auth/login')
          .send({ email: input.email, password: 'wrong-password' })
      ).text,
    )
    bodies.push(
      (await api().post('/api/auth/logout').set('Cookie', cookie)).text,
    )

    for (const body of bodies) {
      expect(body).not.toContain(input.password)
      expect(body).not.toMatch(/argon2|passwordHash/)
      expect(body).not.toContain(tokenOf(cookie))
      expect(body).not.toContain(testJwtSecret)
      expect(body).not.toMatch(/stack|mongodb:\/\//)
    }
  })

  it('logs never contain passwords, tokens, cookies or the secret', async () => {
    const input = buildUserInput()
    const reg = await api().post('/api/auth/register').send(input)
    const cookie = reg.headers['set-cookie'][0].split(';')[0]
    await api().get('/api/auth/me').set('Cookie', cookie)
    await api()
      .post('/api/auth/login')
      .send({ email: input.email, password: 'wrong-password' })
    await api().post('/api/auth/logout').set('Cookie', cookie)

    const logs = JSON.stringify(logLines)
    expect(logLines.length).toBeGreaterThan(0)
    expect(logs).not.toContain(input.password)
    expect(logs).not.toContain('wrong-password')
    expect(logs).not.toContain(tokenOf(cookie))
    expect(logs).not.toContain(testJwtSecret)
    expect(logs).not.toContain(input.email)
  })

  it('the session cookie is not readable by JavaScript', async () => {
    const res = await api().post('/api/auth/register').send(buildUserInput())
    expect(res.headers['set-cookie'][0]).toMatch(/; HttpOnly/)
  })
})

describe('payload limits', () => {
  it('rejects oversized authentication bodies with 413', async () => {
    const res = await api()
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({ ...buildUserInput(), name: 'x'.repeat(200 * 1024) }),
      )
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('bounds password length before hashing (no hash-DoS)', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: 'a@example.test', password: 'p'.repeat(50 * 1024) })
    expect(res.status).toBe(400)
  })
})

describe('CORS and CSRF', () => {
  it('grants credentialed CORS only to the configured client origin', async () => {
    const allowed = await api()
      .options('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_ORIGIN)
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')

    const denied = await api()
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST')
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('rejects state-changing auth requests from a foreign origin', async () => {
    const input = buildUserInput()
    const res = await api()
      .post('/api/auth/register')
      .set('Origin', 'https://evil.example.com')
      .send(input)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
    expect(
      await server.models.User.countDocuments({ email: input.email }),
    ).toBe(0)
  })

  it('rejects a cross-site logout attempt (session survives)', async () => {
    const { cookie } = await registerUser(url)
    await api()
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example.com')
      .set('Cookie', cookie)
      .expect(403)
    await api().get('/api/auth/me').set('Cookie', cookie).expect(200)
  })

  it('accepts state-changing requests from the client origin', async () => {
    await api()
      .post('/api/auth/register')
      .set('Origin', TEST_ORIGIN)
      .send(buildUserInput())
      .expect(201)
  })
})

describe('authentication rate limiting', () => {
  let limited

  afterEach(async () => {
    await limited?.server.close()
    limited = undefined
  })

  it('throttles repeated failed logins per client', async () => {
    limited = await startTestServer({ AUTH_RATE_LIMIT_MAX: '3' })
    const account = await registerUser(limited.url)
    const attempt = (password) =>
      request(limited.url)
        .post('/api/auth/login')
        .send({ email: account.input.email, password })

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt('wrong-password')).status).toBe(401)
    }
    const blocked = await attempt('wrong-password')
    expect(blocked.status).toBe(429)
    expect(blocked.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    })
    // Even the correct password is refused while throttled.
    expect((await attempt(account.input.password)).status).toBe(429)
  })

  it('does not count successful logins against the limit', async () => {
    limited = await startTestServer({ AUTH_RATE_LIMIT_MAX: '2' })
    const account = await registerUser(limited.url)
    for (let i = 0; i < 5; i += 1) {
      await request(limited.url)
        .post('/api/auth/login')
        .send({ email: account.input.email, password: account.input.password })
        .expect(200)
    }
  })

  it('throttles registrations', async () => {
    limited = await startTestServer({ AUTH_RATE_LIMIT_MAX: '2' })
    const register = () =>
      request(limited.url).post('/api/auth/register').send(buildUserInput())
    await register().expect(201)
    await register().expect(201)
    const res = await register()
    expect(res.status).toBe(429)
    expect(res.headers['ratelimit-policy']).toBeDefined()
  })

  it('never throttles health probes or /me', async () => {
    limited = await startTestServer({ AUTH_RATE_LIMIT_MAX: '1' })
    const { cookie } = await registerUser(limited.url)
    for (let i = 0; i < 5; i += 1) {
      await request(limited.url).get('/ready').expect(200)
      await request(limited.url).get('/api/health').expect(200)
      await request(limited.url)
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200)
    }
  })
})
