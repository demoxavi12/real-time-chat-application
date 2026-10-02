import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { buildUserInput } from '../helpers/auth.js'
import { publicRoomId, signedInUser } from '../helpers/chat.js'
import { startTestServer } from '../helpers/server.js'
import {
  closeAll,
  connectAs,
  connected,
  connectSocket,
  join,
  request as emit,
} from '../helpers/sockets.js'

const servers = []
async function serverWith(env) {
  const ctx = await startTestServer(env)
  servers.push(ctx.server)
  return ctx
}

afterEach(async () => {
  closeAll()
  for (const server of servers.splice(0)) await server.close()
})

describe('conversation previews', () => {
  it('shows the latest message (bounded, single line) and reorders the list', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const carol = await signedInUser(url)
    const withBob = await alice.openPrivateWith(bob)
    const withCarol = await alice.openPrivateWith(carol)
    await alice.send(withCarol.id, 'older one')
    const long = `line one\n${'x'.repeat(300)}`
    const latest = await bob.send(withBob.id, long)

    const res = await alice.get('/api/conversations?limit=100')
    const [first, second] = res.body.data.conversations.filter(
      (c) => c.type === 'private',
    )
    expect(first.id).toBe(withBob.id)
    expect(first.lastMessage).toEqual({
      id: latest.id,
      sender: { id: bob.id, name: bob.user.name },
      preview: expect.stringMatching(/^line one x+…$/),
      createdAt: latest.createdAt,
    })
    expect(first.lastMessage.preview).toHaveLength(120)
    expect(second.id).toBe(withCarol.id)
    expect(second.lastMessage.preview).toBe('older one')
  })

  it('never moves the preview back to an older message', async () => {
    const { url, server } = await serverWith()
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const newer = await alice.send(conversation.id, 'newer')
    // A late write for an older message (e.g. a slow concurrent send).
    const { createConversationRepository } =
      await import('../../src/repositories/conversation.repository.js')
    await createConversationRepository(server.models).recordMessage(
      conversation.id,
      {
        _id: '65f0000000000000000000ab',
        senderId: bob.id,
        content: 'stale',
        createdAt: new Date(Date.parse(newer.createdAt) - 60_000),
      },
    )
    const res = await alice.get(`/api/conversations/${conversation.id}`)
    expect(res.body.data.conversation.lastMessage.id).toBe(newer.id)
  })

  it('includes the preview in live conversation:update events', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const b = await connectAs(url, bob)
    const update = new Promise((resolve) =>
      b.on(
        'conversation:update',
        (p) => p.conversation.lastMessage && resolve(p),
      ),
    )
    const sent = await alice.send(conversation.id, 'preview me')
    expect((await update).conversation.lastMessage).toEqual({
      id: sent.id,
      sender: { id: alice.id, name: alice.user.name },
      preview: 'preview me',
      createdAt: sent.createdAt,
    })
  })
})

describe('persisted read state', () => {
  it('reports seen=true in history after the recipient read the message', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    const sent = await alice.send(conversation.id, 'did you read this?')
    expect(sent.seen).toBe(false)

    const b = await connectAs(url, bob)
    await join(b, conversation.id)
    await emit(b, 'message:read', {
      conversationId: conversation.id,
      messageId: sent.id,
    })

    const history = await alice.get(
      `/api/conversations/${conversation.id}/messages`,
    )
    expect(history.body.data.messages[0]).toMatchObject({
      id: sent.id,
      seen: true,
    })
    // Still no reader list in the payload.
    expect(history.text).not.toMatch(/readBy/)
  })

  it('is null for public room messages', async () => {
    const { url } = await serverWith()
    const alice = await signedInUser(url)
    const message = await alice.send(await publicRoomId(alice), 'public')
    expect(message.seen).toBeNull()
  })
})

describe('reverse proxy client addresses (TRUST_PROXY)', () => {
  const register = (url, ip) =>
    request(url)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send(buildUserInput())

  it('rate limits REST per forwarded client when proxies are trusted', async () => {
    const { url } = await serverWith({
      TRUST_PROXY: '1',
      AUTH_RATE_LIMIT_MAX: '1',
    })
    expect((await register(url, '203.0.113.1')).status).toBe(201)
    expect((await register(url, '203.0.113.1')).status).toBe(429)
    expect((await register(url, '203.0.113.2')).status).toBe(201)
  })

  it('ignores X-Forwarded-For when no proxy is trusted (no spoofed bypass)', async () => {
    const { url } = await serverWith({ AUTH_RATE_LIMIT_MAX: '1' })
    expect((await register(url, '203.0.113.1')).status).toBe(201)
    expect((await register(url, '203.0.113.99')).status).toBe(429)
  })

  it('limits socket connections per forwarded client when proxies are trusted', async () => {
    const { url } = await serverWith({
      TRUST_PROXY: '1',
      SOCKET_CONNECTION_RATE_LIMIT: '1',
    })
    const alice = await signedInUser(url)
    const as = (ip) =>
      connected(
        connectSocket(url, null, {
          extraHeaders: { cookie: alice.cookie, 'x-forwarded-for': ip },
        }),
      )
    await as('198.51.100.1')
    const blocked = await as('198.51.100.1').catch((e) => e)
    expect(blocked.message).toBe('RATE_LIMITED')
    await expect(as('198.51.100.2')).resolves.toBeDefined()
  })

  it('ignores forwarded addresses for sockets when no proxy is trusted', async () => {
    const { url } = await serverWith({ SOCKET_CONNECTION_RATE_LIMIT: '1' })
    const alice = await signedInUser(url)
    const as = (ip) =>
      connected(
        connectSocket(url, null, {
          extraHeaders: { cookie: alice.cookie, 'x-forwarded-for': ip },
        }),
      )
    await as('198.51.100.1')
    const blocked = await as('198.51.100.2').catch((e) => e)
    expect(blocked.message).toBe('RATE_LIMITED')
  })
})
