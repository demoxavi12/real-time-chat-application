import { io as connectClient } from 'socket.io-client'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { registerUser } from '../helpers/auth.js'
import { craftToken, startTestServer } from '../helpers/server.js'
import { TEST_ORIGIN } from '../helpers/testEnv.js'

const clients = []
let ctx

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await ctx?.server.close()
  ctx = undefined
})

function connect(options = {}) {
  const client = connectClient(ctx.url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...options,
  })
  clients.push(client)
  return client
}

/** Resolves 'connected' or the connect_error. */
function outcome(client) {
  return new Promise((resolve) => {
    client.once('connect', () => resolve('connected'))
    client.once('connect_error', (error) => resolve(error))
  })
}

describe('Socket.IO handshake authentication', () => {
  it('rejects connections without a session', async () => {
    ctx = await startTestServer()
    const error = await outcome(connect())
    expect(error.message).toBe('AUTHENTICATION_REQUIRED')
    expect(error.data).toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    })
  })

  it('authenticates with the REST session cookie and exposes the verified identity', async () => {
    ctx = await startTestServer()
    const { user, cookie } = await registerUser(ctx.url)
    const client = connect({ extraHeaders: { cookie } })
    expect(await outcome(client)).toBe('connected')

    const [serverSocket] = await ctx.server.io.fetchSockets()
    expect(serverSocket.data.auth).toEqual({
      userId: user.id,
      sessionId: expect.any(String),
      // Sockets are disconnected when the session reaches its absolute end.
      sessionExpiresAt: expect.any(Date),
      name: user.name,
    })
    expect(serverSocket.data.auth.sessionExpiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    )
  })

  it('ignores identity claimed in handshake auth/query (forged sender)', async () => {
    ctx = await startTestServer()
    const alice = await registerUser(ctx.url)
    const bob = await registerUser(ctx.url)
    const client = connect({
      extraHeaders: { cookie: alice.cookie },
      auth: { userId: bob.user.id, token: 'whatever' },
      query: { userId: bob.user.id },
    })
    expect(await outcome(client)).toBe('connected')
    const [serverSocket] = await ctx.server.io.fetchSockets()
    expect(serverSocket.data.auth.userId).toBe(alice.user.id)
  })

  it('does not accept a token passed via handshake auth instead of the cookie', async () => {
    ctx = await startTestServer()
    const { cookie } = await registerUser(ctx.url)
    const error = await outcome(
      connect({ auth: { token: cookie.split('=')[1] } }),
    )
    expect(error.message).toBe('AUTHENTICATION_REQUIRED')
  })

  it.each([
    ['malformed', () => 'rtc_session=garbage'],
    [
      'forged',
      async (user) =>
        `rtc_session=${await craftToken({ sub: user.id, secret: 'x'.repeat(64) })}`,
    ],
    [
      'expired',
      async (user) => {
        const past = Math.floor(Date.now() / 1000) - 7200
        return `rtc_session=${await craftToken({ sub: user.id, iat: past, exp: past + 60, authTime: past })}`
      },
    ],
  ])(
    'rejects a %s token with AUTHENTICATION_INVALID',
    async (_label, makeCookie) => {
      ctx = await startTestServer()
      const { user } = await registerUser(ctx.url)
      const error = await outcome(
        connect({ extraHeaders: { cookie: await makeCookie(user) } }),
      )
      expect(error.message).toBe('AUTHENTICATION_INVALID')
    },
  )

  it('rejects a session after logout', async () => {
    ctx = await startTestServer()
    const { cookie } = await registerUser(ctx.url)
    await request(ctx.url)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(200)
    const error = await outcome(connect({ extraHeaders: { cookie } }))
    expect(error.message).toBe('AUTHENTICATION_INVALID')
  })

  it('rejects a token for a user that no longer exists', async () => {
    ctx = await startTestServer()
    const { user, cookie } = await registerUser(ctx.url)
    await ctx.server.models.User.deleteOne({ _id: user.id })
    const error = await outcome(connect({ extraHeaders: { cookie } }))
    expect(error.message).toBe('AUTHENTICATION_INVALID')
  })

  it('refuses WebSocket upgrades from foreign origins (CSWSH)', async () => {
    ctx = await startTestServer()
    const { cookie } = await registerUser(ctx.url)
    const foreign = await outcome(
      connect({ extraHeaders: { cookie, origin: 'https://evil.example.com' } }),
    )
    expect(foreign).toBeInstanceOf(Error)

    const allowed = connect({ extraHeaders: { cookie, origin: TEST_ORIGIN } })
    expect(await outcome(allowed)).toBe('connected')
  })
})
