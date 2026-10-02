import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

async function pair() {
  const alice = await signedInUser(url)
  const bob = await signedInUser(url)
  const conversation = await alice.openPrivateWith(bob)
  return { alice, bob, conversation }
}

/** Reads the whole history page by page; returns messages oldest first. */
async function readAll(user, conversationId, limit) {
  const pages = []
  let before
  for (let guard = 0; guard < 100; guard += 1) {
    const query = `?limit=${limit}${before ? `&before=${before}` : ''}`
    const res = await user.get(
      `/api/conversations/${conversationId}/messages${query}`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data.messages.length).toBeLessThanOrEqual(limit)
    pages.unshift(res.body.data.messages)
    before = res.body.data.nextCursor
    if (!before) break
  }
  return pages.flat()
}

describe('POST /api/conversations/:id/messages', () => {
  it('persists a message from the authenticated sender', async () => {
    const { alice, conversation } = await pair()
    const res = await alice
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ content: '  Hello Bob!  ' })

    expect(res.status).toBe(201)
    expect(res.body.data.message).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      conversationId: conversation.id,
      sender: { id: alice.id, name: alice.user.name },
      content: 'Hello Bob!',
      clientMessageId: null,
      createdAt: expect.any(String),
      seen: false,
    })
    const stored = await server.models.Message.findById(
      res.body.data.message.id,
    ).lean()
    expect(String(stored.senderId)).toBe(alice.id)
    expect(stored.readBy.map(String)).toEqual([alice.id])
  })

  it('lets both participants post and updates conversation activity', async () => {
    const { alice, bob, conversation } = await pair()
    await alice.send(conversation.id, 'ping')
    const reply = await bob.send(conversation.id, 'pong')
    const stored = await server.models.Conversation.findById(
      conversation.id,
    ).lean()
    expect(stored.lastMessageAt.toISOString()).toBe(reply.createdAt)
    expect(stored.lastActivityAt.toISOString()).toBe(reply.createdAt)
  })

  it('allows any user to post in the public room', async () => {
    const carol = await signedInUser(url)
    const message = await carol.send(
      await publicRoomId(carol),
      'hello everyone',
    )
    expect(message.sender.id).toBe(carol.id)
  })

  it('stores markup verbatim as plain text', async () => {
    const { alice, conversation } = await pair()
    const content = '<img src=x onerror=alert(1)> & "quotes"'
    const message = await alice.send(conversation.id, content)
    expect(message.content).toBe(content)
  })

  it('accepts 2000 characters and rejects 2001', async () => {
    const { alice, conversation } = await pair()
    await alice.send(conversation.id, 'x'.repeat(2000))
    const res = await alice
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ content: 'x'.repeat(2001) })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it.each([
    ['empty content', { content: '' }],
    ['whitespace content', { content: '   ' }],
    ['missing content', {}],
    ['non-string content', { content: ['a'] }],
    [
      'a forged senderId',
      { content: 'hi', senderId: '65f0000000000000000000ff' },
    ],
    [
      'a forged createdAt',
      { content: 'hi', createdAt: '2000-01-01T00:00:00Z' },
    ],
    ['readBy', { content: 'hi', readBy: [] }],
    ['an invalid clientMessageId', { content: 'hi', clientMessageId: 'no' }],
  ])('rejects %s', async (_label, body) => {
    const { alice, conversation } = await pair()
    const res = await alice
      .post(`/api/conversations/${conversation.id}/messages`)
      .send(body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(
      await server.models.Message.countDocuments({
        conversationId: conversation.id,
      }),
    ).toBe(0)
  })

  it('is idempotent per clientMessageId (retries return the original)', async () => {
    const { alice, conversation } = await pair()
    const path = `/api/conversations/${conversation.id}/messages`
    const body = { content: 'only once', clientMessageId: 'retry-abc-123' }
    const first = await alice.post(path).send(body)
    const retry = await alice
      .post(path)
      .send({ ...body, content: 'changed on retry' })
    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(retry.body.data.message).toEqual(first.body.data.message)
    expect(
      await server.models.Message.countDocuments({
        conversationId: conversation.id,
      }),
    ).toBe(1)
  })

  it('creates one message for concurrent retries with the same clientMessageId', async () => {
    const { alice, conversation } = await pair()
    const path = `/api/conversations/${conversation.id}/messages`
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        alice
          .post(path)
          .send({ content: 'burst', clientMessageId: 'burst-id-0001' }),
      ),
    )
    for (const res of results) expect([200, 201]).toContain(res.status)
    expect(new Set(results.map((r) => r.body.data.message.id)).size).toBe(1)
    expect(
      await server.models.Message.countDocuments({
        conversationId: conversation.id,
      }),
    ).toBe(1)
  })

  it('scopes clientMessageId per sender', async () => {
    const { alice, bob, conversation } = await pair()
    const a = await alice.send(conversation.id, 'from alice', {
      clientMessageId: 'same-id-0001',
    })
    const b = await bob.send(conversation.id, 'from bob', {
      clientMessageId: 'same-id-0001',
    })
    expect(a.id).not.toBe(b.id)
    expect(b.sender.id).toBe(bob.id)
  })
})

describe('GET /api/conversations/:id/messages (cursor pagination)', () => {
  it('returns an empty page for a conversation without messages', async () => {
    const { alice, conversation } = await pair()
    const res = await alice.get(
      `/api/conversations/${conversation.id}/messages`,
    )
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ messages: [], nextCursor: null })
  })

  it('returns fewer than a page in chronological order with no cursor', async () => {
    const { alice, bob, conversation } = await pair()
    await alice.send(conversation.id, 'one')
    await bob.send(conversation.id, 'two')
    const res = await bob.get(
      `/api/conversations/${conversation.id}/messages?limit=5`,
    )
    expect(res.body.data.messages.map((m) => m.content)).toEqual(['one', 'two'])
    expect(res.body.data.messages.map((m) => m.sender.id)).toEqual([
      alice.id,
      bob.id,
    ])
    expect(res.body.data.nextCursor).toBeNull()
  })

  it('returns no cursor when the history is exactly one page', async () => {
    const { alice, conversation } = await pair()
    for (const n of [1, 2, 3]) await alice.send(conversation.id, `m${n}`)
    const res = await alice.get(
      `/api/conversations/${conversation.id}/messages?limit=3`,
    )
    expect(res.body.data.messages).toHaveLength(3)
    expect(res.body.data.nextCursor).toBeNull()
  })

  it('pages backwards through longer histories without gaps or duplicates', async () => {
    const { alice, bob, conversation } = await pair()
    const sent = []
    for (let n = 1; n <= 7; n += 1) {
      const author = n % 2 ? alice : bob
      sent.push((await author.send(conversation.id, `message ${n}`)).id)
    }
    const first = await alice.get(
      `/api/conversations/${conversation.id}/messages?limit=3`,
    )
    expect(first.body.data.messages.map((m) => m.content)).toEqual([
      'message 5',
      'message 6',
      'message 7',
    ])
    expect(first.body.data.nextCursor).toEqual(expect.any(String))

    const all = await readAll(alice, conversation.id, 3)
    expect(all.map((m) => m.id)).toEqual(sent)
  })

  it('orders and pages correctly when messages share the same timestamp', async () => {
    const { alice, bob, conversation } = await pair()
    const sameInstant = new Date('2026-05-05T05:05:05.000Z')
    const docs = Array.from({ length: 9 }, (_, i) => ({
      _id: new Types.ObjectId(),
      conversationId: new Types.ObjectId(conversation.id),
      senderId: new Types.ObjectId(i % 2 ? bob.id : alice.id),
      content: `same-time ${i}`,
      readBy: [],
      createdAt: sameInstant,
    }))
    await server.models.Message.collection.insertMany(docs)

    for (const limit of [1, 2, 4, 9, 10]) {
      const all = await readAll(alice, conversation.id, limit)
      const expected = docs.map((d) => String(d._id)).sort()
      expect(all.map((m) => m.id)).toEqual(expected)
      expect(new Set(all.map((m) => m.id)).size).toBe(9)
    }
  })

  it('keeps working when the cursor message was deleted', async () => {
    const { alice, conversation } = await pair()
    for (let n = 1; n <= 5; n += 1) await alice.send(conversation.id, `m${n}`)
    const first = await alice.get(
      `/api/conversations/${conversation.id}/messages?limit=2`,
    )
    const [boundary] = first.body.data.messages
    await server.models.Message.deleteOne({ _id: boundary.id })
    const next = await alice.get(
      `/api/conversations/${conversation.id}/messages?limit=10&before=${first.body.data.nextCursor}`,
    )
    expect(next.status).toBe(200)
    expect(next.body.data.messages.map((m) => m.content)).toEqual([
      'm1',
      'm2',
      'm3',
    ])
  })

  it('rejects malformed cursors and cursors from another conversation', async () => {
    const { alice, conversation } = await pair()
    const other = await alice.openPrivateWith(await signedInUser(url))
    for (let n = 0; n < 3; n += 1) await alice.send(other.id, `x${n}`)
    const foreign = (
      await alice.get(`/api/conversations/${other.id}/messages?limit=1`)
    ).body.data.nextCursor

    for (const before of [
      'bm9wZQ',
      foreign,
      Buffer.from('{"k":"u","id":"x"}').toString('base64url'),
    ]) {
      const res = await alice.get(
        `/api/conversations/${conversation.id}/messages?before=${before}`,
      )
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_CURSOR')
    }
    const garbage = await alice.get(
      `/api/conversations/${conversation.id}/messages?before=%3Cscript%3E`,
    )
    expect(garbage.status).toBe(400)
    expect(garbage.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('bounds the page size', async () => {
    const { alice, conversation } = await pair()
    for (const limit of ['0', '101', 'all']) {
      const res = await alice.get(
        `/api/conversations/${conversation.id}/messages?limit=${limit}`,
      )
      expect(res.status).toBe(400)
    }
  })

  it('reports a deleted sender with a null name instead of failing', async () => {
    const { alice, bob, conversation } = await pair()
    await bob.send(conversation.id, 'soon gone')
    await server.models.User.deleteOne({ _id: bob.id })
    const res = await alice.get(
      `/api/conversations/${conversation.id}/messages`,
    )
    expect(res.body.data.messages[0].sender).toEqual({ id: bob.id, name: null })
  })
})
