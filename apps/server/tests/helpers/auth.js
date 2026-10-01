import request from 'supertest'

let sequence = 0

/**
 * Deterministic, obviously fake user data. Emails use the reserved
 * `.test` TLD (RFC 2606) so they can never belong to a real person.
 */
export function buildUserInput(overrides = {}) {
  sequence += 1
  return {
    name: `Test User ${sequence}`,
    email: `user${sequence}.${process.pid}@example.test`,
    password: `test-passphrase-${sequence}-long-enough`,
    ...overrides,
  }
}

/** Extracts `name=value` of the session cookie from a supertest response. */
export function sessionCookieFrom(res) {
  const header = res.headers['set-cookie'] ?? []
  const cookie = header.find((c) => /^(__Host-)?rtc_session=/.test(c))
  return cookie?.split(';')[0]
}

/** Registers a user over HTTP and returns its session cookie and identity. */
export async function registerUser(baseUrl, overrides = {}) {
  const input = buildUserInput(overrides)
  const res = await request(baseUrl).post('/api/auth/register').send(input)
  if (res.status !== 201) {
    throw new Error(`registration failed: ${res.status} ${res.text}`)
  }
  return { input, user: res.body.data.user, cookie: sessionCookieFrom(res) }
}
