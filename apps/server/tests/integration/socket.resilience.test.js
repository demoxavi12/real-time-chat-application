import net from 'node:net'
import request from 'supertest'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { startServer } from '../../src/server.js'
import { sessionCookieFrom } from '../helpers/auth.js'
import { signedInUser } from '../helpers/chat.js'
import { startTestServer } from '../helpers/server.js'
import {
  barrier,
  closeAll,
  connectAs,
  connected,
  connectSocket,
  disconnected,
  join,
  nextEvent,
  receivedEvents,
  request as emit,
} from '../helpers/sockets.js'
import {
  silentLogger,
  testConfig,
  uniqueDbName,
  withDatabase,
} from '../helpers/testEnv.js'

const servers = []

async function serverWith(env = {}) {
  const ctx = await startTestServer(env)
  servers.push(ctx.server)
  return ctx
}

afterEach(async () => {
  closeAll()
  for (const server of servers.splice(0)) await server.close()
})

let sequence = 0
const clientId = () => `resilience-${Date.now()}-${(sequence += 1)}`

describe('session revocation', () => {
  it('disconnects the live sockets of a session on logout and refuses it afterwards', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const tab1 = await connectAs(url, alice)
    const tab2 = await connectAs(url, alice)
    const gone1 = disconnected(tab1)
    const gone2 = disconnected(tab2)

    await request(url)
      .post('/api/auth/logout')
      .set('Cookie', alice.cookie)
      .expect(200)

    // 'io server disconnect' = server-initiated; clients do not auto-reconnect.
    expect(await gone1).toBe('io server disconnect')
    expect(await gone2).toBe('io server disconnect')
    const retry = await connected(connectSocket(url, alice.cookie)).catch(
      (e) => e,
    )
    expect(retry.message).toBe('AUTHENTICATION_INVALID')
  })

  it("leaves the user's other sessions (devices) connected", async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const login = await request(url)
      .post('/api/auth/login')
      .send({ email: alice.input.email, password: alice.input.password })
    const phoneCookie = sessionCookieFrom(login)
    const laptop = await connectAs(url, alice)
    const phone = await connected(connectSocket(url, phoneCookie))
    const laptopGone = disconnected(laptop)

    await request(url)
      .post('/api/auth/logout')
      .set('Cookie', alice.cookie)
      .expect(200)
    await laptopGone
    await expect(emit(phone, 'presence:list')).resolves.toMatchObject({
      success: true,
    })
  })

  it('disconnects a socket when its session reaches the absolute maximum age', async () => {
    const { url } = await serverWith({
      JWT_EXPIRES_IN: '2s',
      SESSION_MAX_AGE: '2s',
    })
    const alice = await signedInUser(url)
    const socket = await connectAs(url, alice)
    expect(await disconnected(socket)).toBe('io server disconnect')
  })

  it('refuses sockets for a deleted user', async () => {
    const { url, server } = await serverWith()
    const alice = await signedInUser(url)
    await server.models.User.deleteOne({ _id: alice.id })
    const error = await connected(connectSocket(url, alice.cookie)).catch(
      (e) => e,
    )
    expect(error.message).toBe('AUTHENTICATION_INVALID')
  })
})

describe('rate limits', () => {
  it('limits message:send per socket', async () => {
    const { url } = await serverWith({ SOCKET_MESSAGE_RATE_LIMIT: '3' })
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const socket = await connectAs(url, alice)
    const send = () =>
      emit(socket, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'spam?',
      })
    for (let i = 0; i < 3; i += 1) expect((await send()).success).toBe(true)
    expect(await send()).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    })
  })

  it('limits all events per socket', async () => {
    const { url } = await serverWith({ SOCKET_EVENT_RATE_LIMIT: '5' })
    const socket = await connectAs(url, await signedInUser(url))
    const replies = []
    for (let i = 0; i < 7; i += 1)
      replies.push(await emit(socket, 'presence:list'))
    expect(replies.slice(0, 5).every((r) => r.success)).toBe(true)
    expect(replies.slice(5).map((r) => r.error.code)).toEqual([
      'RATE_LIMITED',
      'RATE_LIMITED',
    ])
  })

  it('disconnects sockets that keep sending invalid payloads', async () => {
    const { url } = await serverWith({ SOCKET_INVALID_EVENT_LIMIT: '3' })
    const socket = await connectAs(url, await signedInUser(url))
    const gone = disconnected(socket)
    for (let i = 0; i < 4; i += 1)
      socket.emit('conversation:join', { conversationId: 'bad' })
    expect(await gone).toBe('io server disconnect')
  })

  it('disconnects sockets that flood unknown events', async () => {
    const { url } = await serverWith({ SOCKET_INVALID_EVENT_LIMIT: '3' })
    const socket = await connectAs(url, await signedInUser(url))
    const gone = disconnected(socket)
    for (let i = 0; i < 4; i += 1) socket.emit('admin:grant', { userId: 'me' })
    expect(await gone).toBe('io server disconnect')
  })

  it('limits connection attempts per client address', async () => {
    const { url } = await serverWith({ SOCKET_CONNECTION_RATE_LIMIT: '2' })
    const alice = await signedInUser(url)
    await connectAs(url, alice)
    await connectAs(url, alice)
    const error = await connected(connectSocket(url, alice.cookie)).catch(
      (e) => e,
    )
    expect(error.message).toBe('RATE_LIMITED')
  })

  it('closes connections that send oversized packets', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const socket = await connectAs(url, alice)
    const gone = disconnected(socket)
    socket.emit('message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'x'.repeat(200 * 1024),
    })
    expect(await gone).toBe('transport close')
  })
})

describe('multiple tabs and devices', () => {
  it('delivers to every socket of both participants except the sending one', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const sockets = [
      await connectAs(url, alice),
      await connectAs(url, alice),
      await connectAs(url, bob),
      await connectAs(url, bob),
    ]
    for (const s of sockets) await join(s, conversation.id)
    const [sender, ...others] = sockets
    const deliveries = others.map((s) => nextEvent(s, 'message:new'))
    const reply = await emit(sender, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'fan out',
    })
    for (const delivered of await Promise.all(deliveries)) {
      expect(delivered.message.id).toBe(reply.data.messageId)
    }
    await barrier(sender)
    expect(receivedEvents(sender, 'message:new')).toEqual([])

    // One tab closing does not affect the others.
    others[0].disconnect()
    const again = nextEvent(others[2], 'message:new')
    await emit(others[1], 'message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'still works',
    })
    expect((await again).message.content).toBe('still works')
  })
})

async function freePort() {
  const probe = net.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  return port
}

describe('server restart', () => {
  it('clients reconnect, re-authenticate, rejoin and keep durable history', async () => {
    const port = await freePort()
    const env = {
      PORT: String(port),
      MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('restart')),
      SOCKET_CONNECTION_RATE_LIMIT: '1000',
    }
    let server = await startServer({
      config: testConfig(env),
      logger: silentLogger,
    })
    const url = `http://127.0.0.1:${port}`
    try {
      const alice = await signedInUser(url)
      const bob = await signedInUser(url)
      const conversation = await alice.openPrivateWith(bob)

      // Like the real client: reconnect automatically, rejoin on every connect.
      const live = (user) => {
        const socket = connectSocket(url, user.cookie, {
          reconnection: true,
          reconnectionDelay: 50,
          reconnectionDelayMax: 200,
        })
        socket.on('connect', () => {
          socket.emit('conversation:join', { conversationId: conversation.id })
        })
        return connected(socket)
      }
      const a = await live(alice)
      const b = await live(bob)
      await join(a, conversation.id)
      await join(b, conversation.id)

      const first = await emit(a, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'before restart',
      })

      const aBack = new Promise((resolve) => a.io.once('reconnect', resolve))
      const bBack = new Promise((resolve) => b.io.once('reconnect', resolve))
      await server.close()
      server = await startServer({
        config: testConfig(env),
        logger: silentLogger,
      })
      await Promise.all([aBack, bBack])
      // Rejoin happened in the connect handler; confirm membership.
      await join(a, conversation.id)
      await join(b, conversation.id)

      const delivered = nextEvent(
        b,
        'message:new',
        (p) => p.message.content === 'after restart',
      )
      const second = await emit(a, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'after restart',
      })
      expect((await delivered).message.id).toBe(second.data.messageId)

      const history = await bob.get(
        `/api/conversations/${conversation.id}/messages`,
      )
      expect(history.body.data.messages.map((m) => m.id)).toEqual([
        first.data.messageId,
        second.data.messageId,
      ])
    } finally {
      closeAll()
      await server.close()
    }
  })
})
