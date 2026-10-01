import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConversationRepository } from '../../src/repositories/conversation.repository.js'
import { publicRoomId, signedInUser } from '../helpers/chat.js'
import { startTestServer } from '../helpers/server.js'

let server
let url

beforeAll(async () => {
  ;({ server, url } = await startTestServer())
})

afterAll(async () => {
  await server?.close()
})

describe('public room', () => {
  it('exists exactly once and is visible to every user', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const res = await alice.get('/api/conversations')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const rooms = res.body.data.conversations.filter((c) => c.type === 'public')
    expect(rooms).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        type: 'public',
        name: 'General',
        participants: [],
        createdAt: expect.any(String),
        lastMessageAt: expect.toBeOneOf([null, expect.any(String)]),
      },
    ])
    expect(await publicRoomId(bob)).toBe(rooms[0].id)
    expect(
      await server.models.Conversation.countDocuments({ type: 'public' }),
    ).toBe(1)
  })

  it('can be read by any authenticated user', async () => {
    const carol = await signedInUser(url)
    const id = await publicRoomId(carol)
    const res = await carol.get(`/api/conversations/${id}`)
    expect(res.status).toBe(200)
    expect(res.body.data.conversation).toMatchObject({
      id,
      type: 'public',
      name: 'General',
    })
  })

  it('stays a singleton under concurrent ensure calls (e.g. restarts)', async () => {
    const conversations = createConversationRepository(server.models)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => conversations.ensurePublicRoom()),
    )
    expect(new Set(results.map((r) => String(r.conversation._id))).size).toBe(1)
    expect(
      await server.models.Conversation.countDocuments({ type: 'public' }),
    ).toBe(1)
  })
})

describe('POST /api/conversations/private', () => {
  it('creates the conversation once (201) and then reuses it (200)', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)

    const first = await alice
      .post('/api/conversations/private')
      .send({ userId: bob.id })
    expect(first.status).toBe(201)
    const conversation = first.body.data.conversation
    expect(conversation).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      type: 'private',
      name: null,
      participants: expect.arrayContaining([
        { id: alice.id, name: alice.user.name },
        { id: bob.id, name: bob.user.name },
      ]),
      createdAt: expect.any(String),
      lastMessageAt: null,
    })
    expect(conversation.participants).toHaveLength(2)

    const again = await alice
      .post('/api/conversations/private')
      .send({ userId: bob.id })
    expect(again.status).toBe(200)
    expect(again.body.data.conversation.id).toBe(conversation.id)

    const reverse = await bob
      .post('/api/conversations/private')
      .send({ userId: alice.id })
    expect(reverse.status).toBe(200)
    expect(reverse.body.data.conversation.id).toBe(conversation.id)
  })

  it('creates exactly one conversation under concurrent requests from both users', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const requests = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0
        ? alice.post('/api/conversations/private').send({ userId: bob.id })
        : bob.post('/api/conversations/private').send({ userId: alice.id }),
    )
    const results = await Promise.all(requests)

    for (const res of results) expect([200, 201]).toContain(res.status)
    expect(results.filter((r) => r.status === 201).length).toBeLessThanOrEqual(
      1,
    )
    const ids = new Set(results.map((r) => r.body.data.conversation.id))
    expect(ids.size).toBe(1)
    expect(
      await server.models.Conversation.countDocuments({
        type: 'private',
        participantIds: { $all: [alice.id, bob.id] },
      }),
    ).toBe(1)
  })

  it('rejects a conversation with yourself', async () => {
    const alice = await signedInUser(url)
    const res = await alice
      .post('/api/conversations/private')
      .send({ userId: alice.id })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PARTICIPANT')
  })

  it('returns 404 USER_NOT_FOUND for an unknown user', async () => {
    const alice = await signedInUser(url)
    const res = await alice
      .post('/api/conversations/private')
      .send({ userId: '65f0000000000000000000ff' })
    expect(res.status).toBe(404)
    expect(res.body.error).toEqual({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    })
  })

  it.each([
    ['a malformed id', { userId: 'not-an-id' }],
    ['a missing id', {}],
    ['an operator object', { userId: { $ne: null } }],
    [
      'extra participants',
      { userId: '65f0000000000000000000ff', participantIds: [] },
    ],
    [
      'a forged requester',
      { userId: '65f0000000000000000000ff', requesterId: 'x' },
    ],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const alice = await signedInUser(url)
    const res = await alice.post('/api/conversations/private').send(body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/conversations', () => {
  it('lists only the public room and my private conversations, most recent first', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const carol = await signedInUser(url)
    const withBob = await alice.openPrivateWith(bob)
    const withCarol = await alice.openPrivateWith(carol)
    const notMine = await bob.openPrivateWith(carol)
    await alice.send(withBob.id, 'bump bob to the top')

    const res = await alice.get('/api/conversations?limit=100')
    const ids = res.body.data.conversations.map((c) => c.id)
    expect(ids).toContain(withBob.id)
    expect(ids).toContain(withCarol.id)
    expect(ids).not.toContain(notMine.id)
    expect(ids.indexOf(withBob.id)).toBeLessThan(ids.indexOf(withCarol.id))
    const bumped = res.body.data.conversations.find((c) => c.id === withBob.id)
    expect(bumped.lastMessageAt).toEqual(expect.any(String))
  })

  it('paginates with an opaque cursor without gaps or duplicates', async () => {
    const owner = await signedInUser(url)
    const partners = await Promise.all(
      Array.from({ length: 5 }, () => signedInUser(url)),
    )
    for (const partner of partners) await owner.openPrivateWith(partner)

    const seen = []
    let cursor
    do {
      const query = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2'
      const res = await owner.get(`/api/conversations${query}`)
      expect(res.status).toBe(200)
      expect(res.body.data.conversations.length).toBeLessThanOrEqual(2)
      seen.push(...res.body.data.conversations.map((c) => c.id))
      cursor = res.body.data.nextCursor
    } while (cursor)

    expect(seen).toHaveLength(6) // 5 private + public room
    expect(new Set(seen).size).toBe(6)
  })

  it('rejects an invalid cursor', async () => {
    const alice = await signedInUser(url)
    const res = await alice.get('/api/conversations?cursor=bm9wZQ')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CURSOR')
  })
})

describe('GET /api/conversations/:conversationId', () => {
  it('returns a private conversation to its participants', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const conversation = await alice.openPrivateWith(bob)
    for (const user of [alice, bob]) {
      const res = await user.get(`/api/conversations/${conversation.id}`)
      expect(res.status).toBe(200)
      expect(res.body.data.conversation.id).toBe(conversation.id)
    }
  })

  it('returns 400 for a malformed id', async () => {
    const alice = await signedInUser(url)
    const res = await alice.get('/api/conversations/not-an-id')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('authentication is required', () => {
  it.each([
    ['get', '/api/users'],
    ['get', '/api/conversations'],
    ['post', '/api/conversations/private'],
    ['get', '/api/conversations/65f0000000000000000000ff'],
    ['get', '/api/conversations/65f0000000000000000000ff/messages'],
    ['post', '/api/conversations/65f0000000000000000000ff/messages'],
  ])('%s %s -> 401 without a session', async (method, path) => {
    const res = await request(url)[method](path).send({})
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED')
  })

  it('rejects an invalid session token', async () => {
    const res = await request(url)
      .get('/api/conversations')
      .set('Cookie', 'rtc_session=forged.token.value')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('AUTHENTICATION_INVALID')
  })
})
