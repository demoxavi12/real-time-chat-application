import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publicRoomId, signedInUser } from '../helpers/chat.js'
import { startTestServer } from '../helpers/server.js'
import { TEST_ORIGIN } from '../helpers/testEnv.js'

let server
let url
let alice
let bob
let mallory
let privateConversation

beforeAll(async () => {
  ;({ server, url } = await startTestServer())
  alice = await signedInUser(url)
  bob = await signedInUser(url)
  mallory = await signedInUser(url)
  privateConversation = await alice.openPrivateWith(bob)
  await alice.send(privateConversation.id, 'secret between alice and bob')
})

afterAll(async () => {
  await server?.close()
})

const NOT_FOUND = {
  success: false,
  error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' },
}
const NONEXISTENT = '65f0000000000000000000ee'

describe('IDOR: non-members cannot reach a private conversation', () => {
  it('cannot read the conversation', async () => {
    const res = await mallory.get(
      `/api/conversations/${privateConversation.id}`,
    )
    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND)
  })

  it('cannot read its messages', async () => {
    const res = await mallory.get(
      `/api/conversations/${privateConversation.id}/messages`,
    )
    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND)
    expect(res.text).not.toContain('secret between')
  })

  it('cannot post into it, and nothing is stored', async () => {
    const before = await server.models.Message.countDocuments({
      conversationId: privateConversation.id,
    })
    const res = await mallory
      .post(`/api/conversations/${privateConversation.id}/messages`)
      .send({ content: 'let me in' })
    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND)
    expect(
      await server.models.Message.countDocuments({
        conversationId: privateConversation.id,
      }),
    ).toBe(before)
  })

  it('cannot use a valid cursor from the conversation either', async () => {
    for (let n = 0; n < 3; n += 1)
      await bob.send(privateConversation.id, `more ${n}`)
    const cursor = (
      await bob.get(
        `/api/conversations/${privateConversation.id}/messages?limit=1`,
      )
    ).body.data.nextCursor
    const res = await mallory.get(
      `/api/conversations/${privateConversation.id}/messages?before=${cursor}`,
    )
    expect(res.status).toBe(404)
  })

  it('gets the same answer for guessed ids as for real foreign ids (no enumeration)', async () => {
    const guessed = await mallory.get(`/api/conversations/${NONEXISTENT}`)
    const real = await mallory.get(
      `/api/conversations/${privateConversation.id}`,
    )
    expect(guessed.status).toBe(real.status)
    expect(guessed.body).toEqual(real.body)
  })

  it('does not see it in their conversation list', async () => {
    const res = await mallory.get('/api/conversations?limit=100')
    expect(res.body.data.conversations.map((c) => c.id)).not.toContain(
      privateConversation.id,
    )
  })

  it('cannot read message ids by guessing a message id as a conversation id', async () => {
    const [message] = (
      await alice.get(`/api/conversations/${privateConversation.id}/messages`)
    ).body.data.messages
    const res = await mallory.get(`/api/conversations/${message.id}/messages`)
    expect(res.status).toBe(404)
  })
})

describe('identity cannot be forged', () => {
  it('rejects a client-supplied senderId instead of honouring it', async () => {
    const res = await alice
      .post(`/api/conversations/${privateConversation.id}/messages`)
      .send({ content: 'pretend to be bob', senderId: bob.id })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('always records the authenticated user as sender', async () => {
    const message = await bob.send(privateConversation.id, 'really bob')
    const stored = await server.models.Message.findById(message.id).lean()
    expect(String(stored.senderId)).toBe(bob.id)
  })

  it('ignores identity smuggled through query or headers', async () => {
    // Authorization runs before query validation, so a non-member learns
    // nothing beyond "not found", whatever identity they claim.
    const res = await mallory
      .get(`/api/conversations/${privateConversation.id}?userId=${alice.id}`)
      .set('X-User-Id', alice.id)
    expect(res.status).toBe(404)
    expect(res.body).toEqual(NOT_FOUND)
    // For a member, unknown query parameters are rejected outright.
    const member = await alice.get(
      `/api/conversations/${privateConversation.id}?userId=${bob.id}`,
    )
    expect(member.status).toBe(400)
    expect(member.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('cannot open a conversation on behalf of two other users', async () => {
    const res = await mallory
      .post('/api/conversations/private')
      .send({ userId: alice.id, participantIds: [alice.id, bob.id] })
    expect(res.status).toBe(400)

    const own = await mallory.openPrivateWith(alice)
    expect(own.participants.map((p) => p.id).sort()).toEqual(
      [alice.id, mallory.id].sort(),
    )
  })
})

describe('membership cannot be manipulated', () => {
  it.each([
    ['patch', ''],
    ['put', ''],
    ['delete', ''],
    ['post', '/members'],
    ['delete', '/members/me'],
    ['patch', '/messages'],
  ])('%s /conversations/:id%s does not exist', async (method, suffix) => {
    const agent = request(url)
    const res = await agent[method](
      `/api/conversations/${privateConversation.id}${suffix}`,
    )
      .set('Cookie', mallory.cookie)
      .send({ participantIds: [mallory.id] })
    expect(res.status).toBe(404)
    const stored = await server.models.Conversation.findById(
      privateConversation.id,
    ).lean()
    expect(stored.participantIds.map(String).sort()).toEqual(
      [alice.id, bob.id].sort(),
    )
  })

  it('the public room cannot gain a participant list', async () => {
    const roomId = await publicRoomId(mallory)
    await mallory.send(roomId, 'hi all')
    const stored = await server.models.Conversation.findById(roomId).lean()
    expect(stored.participantIds).toEqual([])
  })
})

describe('input hardening', () => {
  it.each([
    ['malformed id', '/api/conversations/123'],
    ['operator in path', '/api/conversations/%7B%22%24ne%22%3Anull%7D'],
    ['operator in query', `/api/conversations?limit[$gt]=0`],
    ['unknown query field', '/api/conversations?includeAll=true'],
  ])('rejects %s with 400', async (_label, path) => {
    const res = await mallory.get(path)
    expect(res.status).toBe(400)
  })

  it('rejects oversized bodies before they reach the handler', async () => {
    const res = await alice
      .post(`/api/conversations/${privateConversation.id}/messages`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ content: 'x'.repeat(200 * 1024) }))
    expect(res.status).toBe(413)
  })

  it('rejects cross-origin message posts (CSRF)', async () => {
    const res = await alice
      .post(`/api/conversations/${privateConversation.id}/messages`)
      .set('Origin', 'https://evil.example.com')
      .send({ content: 'forged from another site' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('accepts posts from the client origin', async () => {
    const res = await alice
      .post(`/api/conversations/${privateConversation.id}/messages`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'from the real client' })
    expect(res.status).toBe(201)
  })
})

describe('no sensitive data in conversation payloads', () => {
  it('never exposes emails, hashes, privateKey or read state', async () => {
    const responses = [
      await alice.get('/api/conversations?limit=100'),
      await alice.get(`/api/conversations/${privateConversation.id}`),
      await alice.get(`/api/conversations/${privateConversation.id}/messages`),
      await alice.get('/api/users?limit=50'),
    ]
    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(res.text).not.toMatch(
        /passwordHash|argon2|privateKey|readBy|lastSeenAt|createdBy|@example\.test|__v/,
      )
    }
  })
})
