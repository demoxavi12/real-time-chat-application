import { randomBytes } from 'node:crypto'
import { SignJWT, UnsecuredJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  createTokenService,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/services/token.service.js'
import { AppError } from '../../src/utils/AppError.js'

const secret = randomBytes(48).toString('hex')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = Date.UTC(2026, 0, 1)
const userId = '65f000000000000000000001'

function service({
  now = T0,
  ttl = HOUR,
  maxAge = 7 * DAY,
  key = secret,
} = {}) {
  let current = now
  const tokens = createTokenService({
    secret: key,
    tokenTtlMs: ttl,
    sessionMaxAgeMs: maxAge,
    now: () => current,
  })
  return { tokens, setNow: (ms) => (current = ms) }
}

async function expectInvalid(promise) {
  const error = await promise.catch((err) => err)
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({
    statusCode: 401,
    code: 'AUTHENTICATION_INVALID',
  })
}

function craft(claims, { key = secret, alg = 'HS256' } = {}) {
  const iat = Math.floor(T0 / 1000)
  return new SignJWT({ sid: 's1', auth_time: iat, ...claims })
    .setProtectedHeader({ alg })
    .setSubject(userId)
    .setIssuer(claims.iss ?? JWT_ISSUER)
    .setAudience(claims.aud ?? JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(new TextEncoder().encode(key))
}

describe('token service', () => {
  it('issues a token whose verified claims identify user and session', async () => {
    const { tokens } = service()
    const { token, expiresAt } = await tokens.issue(userId)
    expect(token.split('.')).toHaveLength(3)
    expect(expiresAt.getTime()).toBe(T0 + HOUR)

    const claims = await tokens.verify(token)
    expect(claims).toEqual({
      userId,
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      authTime: T0 / 1000,
      exp: (T0 + HOUR) / 1000,
    })
  })

  it('creates a new session id for every login', async () => {
    const { tokens } = service()
    const a = await tokens.verify((await tokens.issue(userId)).token)
    const b = await tokens.verify((await tokens.issue(userId)).token)
    expect(a.sessionId).not.toBe(b.sessionId)
  })

  it('does not put secrets or personal data in the token payload', async () => {
    const { tokens } = service()
    const { token } = await tokens.issue(userId)
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    )
    expect(Object.keys(payload).sort()).toEqual(
      ['aud', 'auth_time', 'exp', 'iat', 'iss', 'sid', 'sub'].sort(),
    )
    expect(token).not.toContain(secret)
  })

  it('rejects an expired token', async () => {
    const { tokens, setNow } = service()
    const { token } = await tokens.issue(userId)
    setNow(T0 + HOUR + 1000)
    await expectInvalid(tokens.verify(token))
  })

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-jwt'],
    ['two segments', 'a.b'],
    ['bad base64', 'eyJ!!!.eyJ!!!.sig'],
  ])('rejects a malformed token (%s)', async (_label, token) => {
    const { tokens } = service()
    await expectInvalid(tokens.verify(token))
  })

  it('rejects a token signed with a different secret', async () => {
    const { tokens } = service()
    const forged = await service({
      key: randomBytes(48).toString('hex'),
    }).tokens.issue(userId)
    await expectInvalid(tokens.verify(forged.token))
  })

  it('rejects a token whose payload was modified (forged user id)', async () => {
    const { tokens } = service()
    const { token } = await tokens.issue(userId)
    const [header, payload, signature] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    claims.sub = '65f000000000000000000002'
    const tampered = Buffer.from(JSON.stringify(claims)).toString('base64url')
    await expectInvalid(tokens.verify(`${header}.${tampered}.${signature}`))
  })

  it('rejects unsigned (alg: none) tokens', async () => {
    const { tokens } = service()
    const unsigned = new UnsecuredJWT({ sid: 's1', auth_time: T0 / 1000 })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(T0 / 1000)
      .setExpirationTime(T0 / 1000 + 3600)
      .encode()
    await expectInvalid(tokens.verify(unsigned))
  })

  it('rejects other HMAC algorithms even with the right secret', async () => {
    const { tokens } = service()
    await expectInvalid(tokens.verify(await craft({}, { alg: 'HS512' })))
  })

  it.each([
    ['issuer', { iss: 'someone-else' }],
    ['audience', { aud: 'another-app' }],
  ])('rejects a token for the wrong %s', async (_label, claims) => {
    const { tokens } = service()
    await expectInvalid(tokens.verify(await craft(claims)))
  })

  it('rejects tokens missing the session claims', async () => {
    const { tokens } = service()
    await expectInvalid(tokens.verify(await craft({ sid: undefined })))
    await expectInvalid(tokens.verify(await craft({ auth_time: 'yesterday' })))
  })

  it('rejects an unexpired token whose session exceeded the maximum age', async () => {
    const { tokens } = service({ maxAge: 7 * DAY })
    const eightDaysAgo = Math.floor((T0 - 8 * DAY) / 1000)
    // Signature, iat and exp are all valid; only the session age is not.
    await expectInvalid(tokens.verify(await craft({ auth_time: eightDaysAgo })))
    const sixDaysAgo = Math.floor((T0 - 6 * DAY) / 1000)
    await expect(
      tokens.verify(await craft({ auth_time: sixDaysAgo })),
    ).resolves.toMatchObject({ authTime: sixDaysAgo })
  })

  describe('sliding renewal', () => {
    it('does not renew while more than half the lifetime remains', async () => {
      const { tokens, setNow } = service()
      const claims = await tokens.verify((await tokens.issue(userId)).token)
      setNow(T0 + 29 * 60_000)
      await expect(tokens.renew(claims)).resolves.toBeNull()
    })

    it('renews the same session once past half the lifetime', async () => {
      const { tokens, setNow } = service()
      const claims = await tokens.verify((await tokens.issue(userId)).token)
      setNow(T0 + 31 * 60_000)
      const renewal = await tokens.renew(claims)
      expect(renewal.expiresAt.getTime()).toBe(T0 + 31 * 60_000 + HOUR)
      const renewed = await tokens.verify(renewal.token)
      expect(renewed).toMatchObject({
        userId,
        sessionId: claims.sessionId,
        authTime: claims.authTime,
      })
    })

    it('never extends a session beyond its absolute maximum age', async () => {
      const { tokens, setNow } = service({ ttl: HOUR, maxAge: 90 * 60_000 })
      const claims = await tokens.verify((await tokens.issue(userId)).token)
      setNow(T0 + 50 * 60_000)
      const renewal = await tokens.renew(claims)
      expect(renewal.expiresAt.getTime()).toBe(T0 + 90 * 60_000)
      expect(tokens.sessionExpiresAt(claims).getTime()).toBe(T0 + 90 * 60_000)
    })
  })
})
