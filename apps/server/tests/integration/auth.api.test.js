import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildUserInput,
  registerUser,
  sessionCookieFrom,
} from '../helpers/auth.js'
import { craftToken, startTestServer } from '../helpers/server.js'

let server
let url

beforeAll(async () => {
  ;({ server, url } = await startTestServer())
})

afterAll(async () => {
  await server?.close()
})

const api = () => request(url)

function parseSetCookie(res) {
  const raw = res.headers['set-cookie']?.[0]
  if (!raw) return null
  const [pair, ...attributes] = raw.split('; ')
  return {
    pair,
    value: pair.slice(pair.indexOf('=') + 1),
    attributes: attributes.map((a) => a.toLowerCase()),
    raw,
  }
}

describe('POST /api/auth/register', () => {
  it('creates the user, returns safe fields and starts a session', async () => {
    const input = buildUserInput()
    const res = await api().post('/api/auth/register').send(input)

    expect(res.status).toBe(201)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({
      success: true,
      data: {
        user: {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: input.name,
          email: input.email,
          createdAt: expect.any(String),
        },
      },
    })
    const cookie = parseSetCookie(res)
    expect(cookie.pair).toMatch(/^rtc_session=[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(cookie.attributes).toEqual(
      expect.arrayContaining(['path=/', 'httponly', 'samesite=lax']),
    )
    expect(cookie.attributes.some((a) => a.startsWith('expires='))).toBe(true)

    const me = await api().get('/api/auth/me').set('Cookie', cookie.pair)
    expect(me.status).toBe(200)
    expect(me.body.data.user.id).toBe(res.body.data.user.id)
  })

  it('never returns the password, its hash or the token in the body', async () => {
    const input = buildUserInput()
    const res = await api().post('/api/auth/register').send(input)
    const body = JSON.stringify(res.body)
    expect(body).not.toContain(input.password)
    expect(body).not.toMatch(/passwordHash|argon2/)
    expect(body).not.toContain(parseSetCookie(res).value)
  })

  it('stores the email normalized and treats case variants as the same account', async () => {
    const input = buildUserInput()
    const mixed = `  ${input.email.toUpperCase()} `
    const res = await api()
      .post('/api/auth/register')
      .send({ ...input, email: mixed })
    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe(input.email)

    const duplicate = await api().post('/api/auth/register').send(input)
    expect(duplicate.status).toBe(409)
  })

  it('returns 409 EMAIL_ALREADY_EXISTS for a duplicate email without a session', async () => {
    const input = buildUserInput()
    await api().post('/api/auth/register').send(input).expect(201)
    const res = await api()
      .post('/api/auth/register')
      .send({
        ...input,
        name: 'Someone Else',
        password: 'another-long-password',
      })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email already exists',
      },
    })
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('creates only one account under concurrent duplicate registrations', async () => {
    const input = buildUserInput()
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post('/api/auth/register').send(input),
      ),
    )
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 409, 409, 409, 409])
    expect(
      await server.models.User.countDocuments({ email: input.email }),
    ).toBe(1)
  })

  it.each([
    ['an invalid email', { email: 'not-an-email' }, 'body.email'],
    ['a missing name', { name: undefined }, 'body.name'],
    ['a missing password', { password: undefined }, 'body.password'],
    ['a too-short password', { password: 'short12' }, 'body.password'],
    ['a too-long password', { password: 'x'.repeat(129) }, 'body.password'],
    ['an over-long name', { name: 'n'.repeat(51) }, 'body.name'],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, override, path) => {
    const res = await api()
      .post('/api/auth/register')
      .send({ ...buildUserInput(), ...override })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.map((d) => d.path)).toContain(path)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('rejects a non-JSON body', async () => {
    const res = await api()
      .post('/api/auth/register')
      .type('form')
      .send('name=a&email=b&password=c')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /api/auth/login', () => {
  let account

  beforeAll(async () => {
    account = await registerUser(url)
  })

  it('authenticates valid credentials and starts a new session', async () => {
    const res = await api().post('/api/auth/login').send({
      email: account.input.email,
      password: account.input.password,
    })
    expect(res.status).toBe(200)
    expect(res.body.data.user).toEqual(account.user)
    const cookie = parseSetCookie(res)
    expect(cookie.attributes).toEqual(
      expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']),
    )
    expect(cookie.pair).not.toBe(account.cookie)
    await api().get('/api/auth/me').set('Cookie', cookie.pair).expect(200)
  })

  it('accepts the email in any case', async () => {
    const res = await api().post('/api/auth/login').send({
      email: account.input.email.toUpperCase(),
      password: account.input.password,
    })
    expect(res.status).toBe(200)
  })

  it('updates lastSeenAt on login', async () => {
    const before = await server.models.User.findById(account.user.id)
    await api()
      .post('/api/auth/login')
      .send({ email: account.input.email, password: account.input.password })
      .expect(200)
    const after = await server.models.User.findById(account.user.id)
    expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      before.lastSeenAt.getTime(),
    )
  })

  it('rejects a wrong password with a generic 401', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: account.input.email, password: 'definitely-wrong' })
    expect(res.status).toBe(401)
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    })
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('answers an unknown email exactly like a wrong password', async () => {
    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ email: account.input.email, password: 'definitely-wrong' })
    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.test', password: 'definitely-wrong' })
    expect(unknownEmail.status).toBe(wrongPassword.status)
    expect(unknownEmail.body).toEqual(wrongPassword.body)
  })

  it.each([
    ['missing password', { email: 'a@example.test' }],
    ['missing email', { password: 'whatever-password' }],
    ['malformed email', { email: 'nope', password: 'whatever-password' }],
    ['operator injection', { email: { $ne: null }, password: { $ne: null } }],
    [
      'extra identity field',
      { email: 'a@example.test', password: 'x', userId: 'u' },
    ],
  ])('rejects a malformed request (%s) with 400', async (_label, body) => {
    const res = await api().post('/api/auth/login').send(body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/auth/me', () => {
  it('returns the current user for a valid session', async () => {
    const { user, cookie } = await registerUser(url)
    const res = await api().get('/api/auth/me').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({ success: true, data: { user } })
  })

  it('returns 401 AUTHENTICATION_REQUIRED without a session', async () => {
    const res = await api().get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    })
  })

  it('returns 401 AUTHENTICATION_INVALID for a malformed token and clears the cookie', async () => {
    const res = await api()
      .get('/api/auth/me')
      .set('Cookie', 'rtc_session=garbage')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_INVALID')
    expect(parseSetCookie(res).raw).toMatch(
      /^rtc_session=;.*Expires=Thu, 01 Jan 1970/,
    )
  })

  it('returns 401 for an expired token', async () => {
    const { user } = await registerUser(url)
    const past = Math.floor(Date.now() / 1000) - 7200
    const token = await craftToken({
      sub: user.id,
      iat: past,
      exp: past + 3600,
      authTime: past,
    })
    const res = await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_INVALID')
  })

  it('returns 401 when the token references a user that does not exist', async () => {
    const token = await craftToken({ sub: '65f0000000000000000000ff' })
    const res = await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_INVALID')
  })

  it('returns 401 when the token subject is not a valid id', async () => {
    const token = await craftToken({ sub: 'not-an-object-id' })
    const res = await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${token}`)
    expect(res.status).toBe(401)
  })

  it('renews the cookie for the same session once past half its lifetime', async () => {
    const { user, cookie } = await registerUser(url)
    const original = await api().get('/api/auth/me').set('Cookie', cookie)
    expect(original.headers['set-cookie']).toBeUndefined()

    const now = Math.floor(Date.now() / 1000)
    const aging = await craftToken({
      sub: user.id,
      iat: now - 3000,
      exp: now + 600,
      authTime: now - 3000,
    })
    const res = await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${aging}`)
    expect(res.status).toBe(200)
    const renewed = parseSetCookie(res)
    expect(renewed.value).not.toBe(aging)
    const payload = JSON.parse(
      Buffer.from(renewed.value.split('.')[1], 'base64url').toString(),
    )
    expect(payload).toMatchObject({
      sub: user.id,
      sid: 'crafted-session',
      auth_time: now - 3000,
    })
    expect(payload.exp).toBeGreaterThan(now + 3000)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { cookie } = await registerUser(url)
    await api().get('/api/auth/me').set('Cookie', cookie).expect(200)

    const res = await api().post('/api/auth/logout').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { loggedOut: true } })
    expect(parseSetCookie(res).raw).toMatch(
      /^rtc_session=;.*Expires=Thu, 01 Jan 1970/,
    )

    // The old token is rejected even though it has not expired yet.
    const after = await api().get('/api/auth/me').set('Cookie', cookie)
    expect(after.status).toBe(401)
    expect(after.body.error.code).toBe('AUTHENTICATION_INVALID')
  })

  it('revokes renewed tokens of the same session too', async () => {
    const { user } = await registerUser(url)
    const now = Math.floor(Date.now() / 1000)
    const aging = await craftToken({
      sub: user.id,
      sid: 'sliding-session',
      iat: now - 3000,
      exp: now + 600,
      authTime: now - 3000,
    })
    const renewedRes = await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${aging}`)
    const renewed = sessionCookieFrom(renewedRes)

    await api().post('/api/auth/logout').set('Cookie', renewed).expect(200)

    await api().get('/api/auth/me').set('Cookie', renewed).expect(401)
    await api()
      .get('/api/auth/me')
      .set('Cookie', `rtc_session=${aging}`)
      .expect(401)
  })

  it('stores the revocation with an expiry so MongoDB can purge it', async () => {
    const { cookie } = await registerUser(url)
    await api().post('/api/auth/logout').set('Cookie', cookie).expect(200)
    const sid = JSON.parse(
      Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString(),
    ).sid
    const doc = await server.models.RevokedSession.findOne({ sessionId: sid })
    expect(doc.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('does not affect other sessions of the same user', async () => {
    const account = await registerUser(url)
    const second = await api().post('/api/auth/login').send({
      email: account.input.email,
      password: account.input.password,
    })
    await api()
      .post('/api/auth/logout')
      .set('Cookie', account.cookie)
      .expect(200)
    await api()
      .get('/api/auth/me')
      .set('Cookie', sessionCookieFrom(second))
      .expect(200)
  })

  it('is idempotent without a session (200, cookie cleared)', async () => {
    const res = await api().post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ loggedOut: true })
    expect(parseSetCookie(res).raw).toMatch(/^rtc_session=;/)
  })

  it('tolerates an invalid token on logout', async () => {
    const res = await api()
      .post('/api/auth/logout')
      .set('Cookie', 'rtc_session=garbage')
    expect(res.status).toBe(200)
  })

  it('allows logging in again after logout', async () => {
    const account = await registerUser(url)
    await api()
      .post('/api/auth/logout')
      .set('Cookie', account.cookie)
      .expect(200)
    const res = await api().post('/api/auth/login').send({
      email: account.input.email,
      password: account.input.password,
    })
    expect(res.status).toBe(200)
    await api()
      .get('/api/auth/me')
      .set('Cookie', sessionCookieFrom(res))
      .expect(200)
  })
})
