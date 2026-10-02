import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { publicRoomId, signedInUser } from '../helpers/chat.js'
import { startTestServer } from '../helpers/server.js'
import {
  barrier,
  closeAll,
  connectAs,
  join,
  nextEvent,
  receivedEvents,
  request,
} from '../helpers/sockets.js'

let server
let url

beforeAll(async () => {
  ;({ server, url } = await startTestServer())
})

afterEach(() => {
  closeAll()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await server?.close()
})

let sequence = 0
const clientId = () => `client-msg-${Date.now()}-${(sequence += 1)}`

/** Alice + Bob with a private conversation, Carol as the outsider. */
async function trio() {
  const alice = await signedInUser(url)
  const bob = await signedInUser(url)
  const carol = await signedInUser(url)
  const conversation = await alice.openPrivateWith(bob)
  return { alice, bob, carol, conversation }
}

const countMessages = (conversationId) =>
  server.models.Message.countDocuments({ conversationId })

describe('conversation rooms', () => {
  it('lets participants join their private conversation (idempotently)', async () => {
    const { alice, conversation } = await trio()
    const socket = await connectAs(url, alice)
    for (let i = 0; i < 3; i += 1) {
      await expect(
        request(socket, 'conversation:join', {
          conversationId: conversation.id,
        }),
      ).resolves.toEqual({
        success: true,
        data: { conversationId: conversation.id },
      })
    }
    const [serverSocket] = await server.io
      .in(`conversation:${conversation.id}`)
      .fetchSockets()
    expect(serverSocket.id).toBe(socket.id)
    expect(
      [...serverSocket.rooms].filter((r) => r.startsWith('conversation:')),
    ).toEqual([`conversation:${conversation.id}`])
  })

  it('lets everyone join the public room and several rooms at once', async () => {
    const { carol, alice, bob } = await trio()
    const withBob = await carol.openPrivateWith(bob)
    const roomId = await publicRoomId(carol)
    const socket = await connectAs(url, carol)
    await join(socket, roomId)
    await join(socket, withBob.id)
    const rooms = (
      await server.io.in(`conversation:${roomId}`).fetchSockets()
    ).map((s) => s.id)
    expect(rooms).toContain(socket.id)
    expect(alice).toBeDefined()
  })

  it('refuses outsiders, unknown ids and forged authorization claims', async () => {
    const { carol, conversation } = await trio()
    const socket = await connectAs(url, carol)
    const notFound = {
      success: false,
      error: {
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      },
    }
    expect(
      await request(socket, 'conversation:join', {
        conversationId: conversation.id,
      }),
    ).toEqual(notFound)
    expect(
      await request(socket, 'conversation:join', {
        conversationId: '65f0000000000000000000ee',
      }),
    ).toEqual(notFound)
    const forged = await request(socket, 'conversation:join', {
      conversationId: conversation.id,
      authorized: true,
      userId: conversation.participants[0].id,
    })
    expect(forged.error.code).toBe('VALIDATION_ERROR')
    for (const conversationId of ['nope', { $ne: null }, undefined]) {
      const res = await request(socket, 'conversation:join', { conversationId })
      expect(res.error.code).toBe('VALIDATION_ERROR')
    }
    expect(
      await server.io.in(`conversation:${conversation.id}`).fetchSockets(),
    ).toEqual([])
  })

  it('stops delivery after leaving', async () => {
    const { alice, bob, conversation } = await trio()
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    await join(a, conversation.id)
    await join(b, conversation.id)
    await request(b, 'conversation:leave', { conversationId: conversation.id })

    await request(a, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'after leave',
    })
    await barrier(b)
    expect(receivedEvents(b, 'message:new')).toEqual([])
  })
})

describe('message:send', () => {
  it('persists, acknowledges with the canonical message, then delivers to the room', async () => {
    const { alice, bob, carol, conversation } = await trio()
    const a = await connectAs(url, alice)
    const aSecondTab = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    const c = await connectAs(url, carol)
    for (const s of [a, aSecondTab, b]) await join(s, conversation.id)

    const id = clientId()
    const delivered = nextEvent(b, 'message:new')
    const otherTab = nextEvent(aSecondTab, 'message:new')
    const reply = await request(a, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: id,
      content: '  hello in real time  ',
    })

    expect(reply).toEqual({
      success: true,
      data: {
        clientMessageId: id,
        messageId: expect.stringMatching(/^[0-9a-f]{24}$/),
        createdAt: expect.any(String),
        duplicate: false,
        message: {
          id: reply.data.messageId,
          conversationId: conversation.id,
          sender: { id: alice.id, name: alice.user.name },
          content: 'hello in real time',
          clientMessageId: id,
          createdAt: reply.data.createdAt,
          seen: false,
        },
      },
    })
    // Durable before anyone was told.
    const stored = await server.models.Message.findById(
      reply.data.messageId,
    ).lean()
    expect(stored.content).toBe('hello in real time')

    expect(await delivered).toEqual({ message: reply.data.message })
    expect(await otherTab).toEqual({ message: reply.data.message })

    // The sending socket gets the ack, not a second copy; outsiders get nothing.
    await barrier(a)
    await barrier(c)
    expect(receivedEvents(a, 'message:new')).toEqual([])
    expect(c.received.filter((r) => r.event !== 'presence:update')).toEqual([])
  })

  it('updates participants not viewing the conversation via conversation:update', async () => {
    const { alice, bob, carol, conversation } = await trio()
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    const c = await connectAs(url, carol)
    const update = nextEvent(b, 'conversation:update')
    const reply = await request(a, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'ping',
    })
    const { conversation: updated } = await update
    expect(updated).toMatchObject({
      id: conversation.id,
      type: 'private',
      lastMessageAt: reply.data.createdAt,
    })
    expect(JSON.stringify(updated)).not.toMatch(/privateKey|readBy|@example/)
    await barrier(b)
    expect(receivedEvents(b, 'message:new')).toEqual([])
    await barrier(c)
    expect(receivedEvents(c, 'conversation:update')).toEqual([])
  })

  it('emits message:ack when the client did not ask for an acknowledgement', async () => {
    const { alice, conversation } = await trio()
    const a = await connectAs(url, alice)
    const ack = nextEvent(a, 'message:ack')
    const id = clientId()
    a.emit('message:send', {
      conversationId: conversation.id,
      clientMessageId: id,
      content: 'no callback',
    })
    expect(await ack).toMatchObject({
      clientMessageId: id,
      messageId: expect.any(String),
      createdAt: expect.any(String),
      duplicate: false,
    })
  })

  it('also delivers messages sent over REST', async () => {
    const { alice, bob, conversation } = await trio()
    const b = await connectAs(url, bob)
    await join(b, conversation.id)
    const delivered = nextEvent(b, 'message:new')
    const message = await alice.send(conversation.id, 'via REST')
    expect(await delivered).toEqual({ message })
  })

  it('tells both participants when a private conversation is created', async () => {
    const alice = await signedInUser(url)
    const bob = await signedInUser(url)
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    const forA = nextEvent(a, 'conversation:update')
    const forB = nextEvent(b, 'conversation:update')
    const conversation = await alice.openPrivateWith(bob)
    expect((await forA).conversation.id).toBe(conversation.id)
    expect((await forB).conversation.id).toBe(conversation.id)
  })

  it('broadcasts public room messages to everyone who joined it', async () => {
    const { alice, carol } = await trio()
    const roomId = await publicRoomId(alice)
    const a = await connectAs(url, alice)
    const c = await connectAs(url, carol)
    await join(a, roomId)
    await join(c, roomId)
    const delivered = nextEvent(c, 'message:new')
    await request(a, 'message:send', {
      conversationId: roomId,
      clientMessageId: clientId(),
      content: 'hi all',
    })
    expect((await delivered).message.content).toBe('hi all')
  })

  describe('validation and authorization', () => {
    it.each([
      ['missing clientMessageId', (c) => ({ conversationId: c, content: 'x' })],
      [
        'invalid clientMessageId',
        (c) => ({ conversationId: c, clientMessageId: 'bad id', content: 'x' }),
      ],
      [
        'empty content',
        (c) => ({
          conversationId: c,
          clientMessageId: clientId(),
          content: '   ',
        }),
      ],
      [
        '2001 characters',
        (c) => ({
          conversationId: c,
          clientMessageId: clientId(),
          content: 'x'.repeat(2001),
        }),
      ],
      [
        'a forged senderId',
        (c) => ({
          conversationId: c,
          clientMessageId: clientId(),
          content: 'x',
          senderId: '65f0000000000000000000ee',
        }),
      ],
      [
        'a forged createdAt',
        (c) => ({
          conversationId: c,
          clientMessageId: clientId(),
          content: 'x',
          createdAt: '2000-01-01',
        }),
      ],
      [
        'a malformed conversationId',
        () => ({
          conversationId: '../x',
          clientMessageId: clientId(),
          content: 'x',
        }),
      ],
      [
        'an operator object',
        () => ({
          conversationId: { $gt: '' },
          clientMessageId: clientId(),
          content: 'x',
        }),
      ],
      ['no payload', () => undefined],
    ])(
      'rejects %s, stores nothing and broadcasts nothing',
      async (_label, build) => {
        const { alice, bob, conversation } = await trio()
        const a = await connectAs(url, alice)
        const b = await connectAs(url, bob)
        await join(b, conversation.id)
        const reply = await request(a, 'message:send', build(conversation.id))
        expect(reply.success).toBe(false)
        expect(reply.error.code).toBe('VALIDATION_ERROR')
        await barrier(b)
        expect(receivedEvents(b, 'message:new')).toEqual([])
        expect(await countMessages(conversation.id)).toBe(0)
      },
    )

    it('refuses outsiders without storing or leaking anything', async () => {
      const { alice, bob, carol, conversation } = await trio()
      const a = await connectAs(url, alice)
      await join(a, conversation.id)
      const c = await connectAs(url, carol)
      const reply = await request(c, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'let me in',
      })
      expect(reply).toEqual({
        success: false,
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found',
        },
      })
      await barrier(a)
      expect(receivedEvents(a, 'message:new')).toEqual([])
      expect(await countMessages(conversation.id)).toBe(0)
      expect(bob).toBeDefined()
    })
  })

  describe('duplicates and retries', () => {
    it('returns the original message for a retry and broadcasts it only once', async () => {
      const { alice, bob, conversation } = await trio()
      const a = await connectAs(url, alice)
      const b = await connectAs(url, bob)
      await join(b, conversation.id)
      const payload = {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'once',
      }

      const first = await request(a, 'message:send', payload)
      // e.g. the first ack was lost and the client retries, even with edits
      const retry = await request(a, 'message:send', {
        ...payload,
        content: 'changed',
      })

      expect(retry.data).toMatchObject({
        duplicate: true,
        messageId: first.data.messageId,
      })
      expect(retry.data.message).toEqual(first.data.message)
      await barrier(b)
      expect(receivedEvents(b, 'message:new')).toHaveLength(1)
      expect(await countMessages(conversation.id)).toBe(1)
    })

    it('stores one message for concurrent duplicate sends', async () => {
      const { alice, bob, conversation } = await trio()
      const a = await connectAs(url, alice)
      const b = await connectAs(url, bob)
      await join(b, conversation.id)
      const payload = {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'burst',
      }
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => request(a, 'message:send', payload)),
      )
      expect(new Set(replies.map((r) => r.data.messageId)).size).toBe(1)
      expect(replies.filter((r) => !r.data.duplicate)).toHaveLength(1)
      await barrier(b)
      expect(receivedEvents(b, 'message:new')).toHaveLength(1)
      expect(await countMessages(conversation.id)).toBe(1)
    })

    it('shares deduplication with REST for the same sender and conversation', async () => {
      const { alice, conversation } = await trio()
      const a = await connectAs(url, alice)
      const id = clientId()
      const viaRest = await alice.send(conversation.id, 'rest first', {
        clientMessageId: id,
      })
      const viaSocket = await request(a, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: id,
        content: 'socket retry',
      })
      expect(viaSocket.data).toMatchObject({
        duplicate: true,
        messageId: viaRest.id,
      })
    })

    it('scopes clientMessageId per conversation and per sender', async () => {
      const { alice, bob, conversation } = await trio()
      const roomId = await publicRoomId(alice)
      const a = await connectAs(url, alice)
      const b = await connectAs(url, bob)
      const id = clientId()
      const one = await request(a, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: id,
        content: 'a',
      })
      const two = await request(a, 'message:send', {
        conversationId: roomId,
        clientMessageId: id,
        content: 'b',
      })
      const three = await request(b, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: id,
        content: 'c',
      })
      expect(new Set([one, two, three].map((r) => r.data.messageId)).size).toBe(
        3,
      )
      expect([one, two, three].every((r) => r.data.duplicate === false)).toBe(
        true,
      )
      expect(three.data.message.sender.id).toBe(bob.id)
    })
  })

  describe('persistence failure', () => {
    it('acks an error, announces nothing, and a retry succeeds exactly once', async () => {
      const { alice, bob, conversation } = await trio()
      const a = await connectAs(url, alice)
      const b = await connectAs(url, bob)
      await join(b, conversation.id)
      const realCreate = server.models.Message.create.bind(
        server.models.Message,
      )
      vi.spyOn(server.models.Message, 'create').mockImplementationOnce(
        async () => {
          throw new Error('simulated MongoDB write failure')
        },
      )

      const payload = {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'fragile',
      }
      const failed = await request(a, 'message:send', payload)
      expect(failed).toEqual({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      })
      expect(await countMessages(conversation.id)).toBe(0)

      server.models.Message.create.mockImplementation(realCreate)
      const delivered = nextEvent(b, 'message:new')
      const retried = await request(a, 'message:send', payload)
      expect(retried.data.duplicate).toBe(false)
      // The first message:new Bob ever sees is the successful retry.
      expect((await delivered).message.id).toBe(retried.data.messageId)
      expect(receivedEvents(b, 'message:new')).toHaveLength(1)
      expect(await countMessages(conversation.id)).toBe(1)
    })

    it('keeps the message and still delivers to others when a recipient is offline', async () => {
      const { alice, bob, conversation } = await trio()
      const a = await connectAs(url, alice)
      const aOtherTab = await connectAs(url, alice)
      const b = await connectAs(url, bob)
      for (const s of [aOtherTab, b]) await join(s, conversation.id)
      b.disconnect()

      const delivered = nextEvent(aOtherTab, 'message:new')
      const reply = await request(a, 'message:send', {
        conversationId: conversation.id,
        clientMessageId: clientId(),
        content: 'while bob was away',
      })
      expect(reply.success).toBe(true)
      expect((await delivered).message.id).toBe(reply.data.messageId)

      // Bob catches up from durable history after reconnecting.
      const bAgain = await connectAs(url, bob)
      await join(bAgain, conversation.id)
      const history = await bob.get(
        `/api/conversations/${conversation.id}/messages`,
      )
      expect(history.body.data.messages.map((m) => m.id)).toContain(
        reply.data.messageId,
      )
    })
  })
})

describe('typing', () => {
  it('relays typing to others in the room, once, and clears it on disconnect', async () => {
    const { alice, bob, conversation } = await trio()
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    await join(a, conversation.id)
    await join(b, conversation.id)

    const started = nextEvent(b, 'typing:update')
    await request(a, 'typing:start', { conversationId: conversation.id })
    await request(a, 'typing:start', { conversationId: conversation.id })
    expect(await started).toEqual({
      conversationId: conversation.id,
      userId: alice.id,
      typing: true,
    })

    const stopped = nextEvent(b, 'typing:update', (p) => !p.typing)
    a.disconnect()
    expect(await stopped).toEqual({
      conversationId: conversation.id,
      userId: alice.id,
      typing: false,
    })
    await barrier(b)
    expect(receivedEvents(b, 'typing:update')).toHaveLength(2)
  })

  it('stops typing when the message is sent', async () => {
    const { alice, bob, conversation } = await trio()
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    await join(a, conversation.id)
    await join(b, conversation.id)
    await request(a, 'typing:start', { conversationId: conversation.id })
    const stopped = nextEvent(b, 'typing:update', (p) => !p.typing)
    await request(a, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'done',
    })
    expect((await stopped).userId).toBe(alice.id)
  })

  it('refuses outsiders even before any join', async () => {
    const { carol, conversation } = await trio()
    const c = await connectAs(url, carol)
    const reply = await request(c, 'typing:start', {
      conversationId: conversation.id,
    })
    expect(reply.error.code).toBe('CONVERSATION_NOT_FOUND')
  })

  it('relays typing sent immediately after join (no ordering race)', async () => {
    const { alice, bob, conversation } = await trio()
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    await join(a, conversation.id)
    const typing = nextEvent(a, 'typing:update')
    // Fire-and-forget join followed at once by typing, like the real client.
    b.emit('conversation:join', { conversationId: conversation.id })
    b.emit('typing:start', { conversationId: conversation.id })
    expect(await typing).toEqual({
      conversationId: conversation.id,
      userId: bob.id,
      typing: true,
    })
  })
})

describe('message:read', () => {
  it('records reads in private conversations and notifies the room once', async () => {
    const { alice, bob, conversation } = await trio()
    const a = await connectAs(url, alice)
    const b = await connectAs(url, bob)
    await join(a, conversation.id)
    await join(b, conversation.id)
    const sent = await request(a, 'message:send', {
      conversationId: conversation.id,
      clientMessageId: clientId(),
      content: 'read me',
    })

    const update = nextEvent(a, 'message:read:update')
    const first = await request(b, 'message:read', {
      conversationId: conversation.id,
      messageId: sent.data.messageId,
    })
    expect(first).toEqual({ success: true, data: { recorded: true } })
    expect(await update).toEqual({
      conversationId: conversation.id,
      messageId: sent.data.messageId,
      userId: bob.id,
    })
    await request(b, 'message:read', {
      conversationId: conversation.id,
      messageId: sent.data.messageId,
    })
    await barrier(a)
    expect(receivedEvents(a, 'message:read:update')).toHaveLength(1)

    const stored = await server.models.Message.findById(
      sent.data.messageId,
    ).lean()
    expect(stored.readBy.map(String).sort()).toEqual([alice.id, bob.id].sort())
  })

  it('does not record reads in the public room', async () => {
    const { alice } = await trio()
    const roomId = await publicRoomId(alice)
    const a = await connectAs(url, alice)
    await join(a, roomId)
    const sent = await request(a, 'message:send', {
      conversationId: roomId,
      clientMessageId: clientId(),
      content: 'public',
    })
    const reply = await request(a, 'message:read', {
      conversationId: roomId,
      messageId: sent.data.messageId,
    })
    expect(reply).toEqual({ success: true, data: { recorded: false } })
  })

  it('rejects outsiders and messages from other conversations', async () => {
    const { alice, bob, carol, conversation } = await trio()
    const other = await alice.openPrivateWith(carol)
    const foreign = await alice.send(other.id, 'elsewhere')
    const b = await connectAs(url, bob)
    const wrongConversation = await request(b, 'message:read', {
      conversationId: conversation.id,
      messageId: foreign.id,
    })
    expect(wrongConversation.error.code).toBe('MESSAGE_NOT_FOUND')
    const c = await connectAs(url, carol)
    const outsider = await request(c, 'message:read', {
      conversationId: conversation.id,
      messageId: foreign.id,
    })
    expect(outsider.error.code).toBe('CONVERSATION_NOT_FOUND')
    const stored = await server.models.Message.findById(foreign.id).lean()
    expect(stored.readBy.map(String)).toEqual([alice.id])
  })
})

describe('presence', () => {
  it('is online while any socket is connected (multiple tabs/devices)', async () => {
    const alice = await signedInUser(url)
    const watcher = await connectAs(url, await signedInUser(url))

    const online = nextEvent(
      watcher,
      'presence:update',
      (p) => p.userId === alice.id,
    )
    const tab1 = await connectAs(url, alice)
    expect(await online).toEqual({ userId: alice.id, status: 'online' })
    const tab2 = await connectAs(url, alice)
    expect((await request(watcher, 'presence:list')).data.online).toContain(
      alice.id,
    )

    tab1.disconnect()
    await barrier(tab2)
    await barrier(watcher)
    expect(
      receivedEvents(watcher, 'presence:update').filter(
        (p) => p.userId === alice.id,
      ),
    ).toEqual([{ userId: alice.id, status: 'online' }])

    const offline = nextEvent(
      watcher,
      'presence:update',
      (p) => p.userId === alice.id && p.status === 'offline',
    )
    tab2.disconnect()
    await offline
    expect((await request(watcher, 'presence:list')).data.online).not.toContain(
      alice.id,
    )
    const stored = await server.models.User.findById(alice.id).lean()
    expect(stored.lastSeenAt).toBeInstanceOf(Date)
  })
})
