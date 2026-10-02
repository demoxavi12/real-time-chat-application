import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindEvent } from '../../src/sockets/bindEvent.js'
import { createPresenceTracker } from '../../src/sockets/presence.js'
import {
  createSocketLimiter,
  createWindowCounter,
} from '../../src/sockets/rateLimit.js'
import { createRealtimeHub } from '../../src/sockets/realtime.js'
import {
  conversationRoom,
  sessionRoom,
  userRoom,
} from '../../src/sockets/rooms.js'
import { AppError } from '../../src/utils/AppError.js'
import {
  conversationEventSchema,
  readMessageSchema,
  socketSendMessageSchema,
} from '../../src/validators/socket.validators.js'
import { createMemoryLogger, silentLogger } from '../helpers/testEnv.js'

const ID = '65f0000000000000000000aa'

describe('room names', () => {
  it('are prefixed so namespaces never collide', () => {
    expect(conversationRoom(ID)).toBe(`conversation:${ID}`)
    expect(userRoom(ID)).toBe(`user:${ID}`)
    expect(sessionRoom('s1')).toBe('session:s1')
    expect(new Set([conversationRoom(ID), userRoom(ID)]).size).toBe(2)
  })
})

describe('window counters', () => {
  it('allows max events per window and resets afterwards', () => {
    let now = 0
    const counter = createWindowCounter({
      windowMs: 1000,
      max: 2,
      now: () => now,
    })
    expect([
      counter.consume('k'),
      counter.consume('k'),
      counter.consume('k'),
    ]).toEqual([true, true, false])
    expect(counter.consume('other')).toBe(true)
    now = 1000
    expect(counter.consume('k')).toBe(true)
  })

  it('keeps independent per-socket categories', () => {
    const limiter = createSocketLimiter({
      windowMs: 1000,
      eventLimit: 3,
      messageLimit: 1,
      invalidEventLimit: 1,
    })
    expect(limiter.consume('message')).toBe(true)
    expect(limiter.consume('message')).toBe(false)
    expect(limiter.consume('event')).toBe(true)
    expect(limiter.consume('invalid')).toBe(true)
    expect(limiter.consume('invalid')).toBe(false)
  })
})

describe('presence tracker', () => {
  it('counts sockets per user', () => {
    const presence = createPresenceTracker()
    expect(presence.connect('a')).toBe(true)
    expect(presence.connect('a')).toBe(false)
    expect(presence.onlineUserIds()).toEqual(['a'])
    expect(presence.disconnect('a')).toBe(false)
    expect(presence.isOnline('a')).toBe(true)
    expect(presence.disconnect('a')).toBe(true)
    expect(presence.isOnline('a')).toBe(false)
    expect(presence.disconnect('a')).toBe(false)
  })
})

describe('socket payload schemas', () => {
  it('accepts the documented message:send payload', () => {
    expect(
      socketSendMessageSchema.parse({
        conversationId: ID,
        clientMessageId: 'abcd-1234',
        content: ' hi ',
      }),
    ).toEqual({
      conversationId: ID,
      clientMessageId: 'abcd-1234',
      content: 'hi',
    })
  })

  it.each([
    ['senderId', { senderId: ID }],
    ['authorized', { authorized: true }],
    ['missing clientMessageId', { clientMessageId: undefined }],
    ['oversized content', { content: 'x'.repeat(2001) }],
    ['bad id', { conversationId: 'x' }],
  ])('rejects %s', (_label, override) => {
    expect(
      socketSendMessageSchema.safeParse({
        conversationId: ID,
        clientMessageId: 'abcd-1234',
        content: 'hi',
        ...override,
      }).success,
    ).toBe(false)
  })

  it('is strict for join/typing/read payloads', () => {
    expect(
      conversationEventSchema.safeParse({ conversationId: ID }).success,
    ).toBe(true)
    expect(
      conversationEventSchema.safeParse({ conversationId: ID, userId: ID })
        .success,
    ).toBe(false)
    expect(
      readMessageSchema.safeParse({ conversationId: ID, messageId: 'x' })
        .success,
    ).toBe(false)
  })
})

function fakeSocket() {
  const socket = new EventEmitter()
  socket.id = 'sock-1'
  socket.emitted = []
  const emit = socket.emit.bind(socket)
  socket.emit = (event, ...args) => {
    if (event === 'ping-test') return emit(event, ...args)
    socket.emitted.push([event, ...args])
    return true
  }
  socket.trigger = (event, ...args) => emit(event, ...args)
  socket.disconnect = vi.fn()
  return socket
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('bindEvent', () => {
  it('acks success and failure envelopes', async () => {
    const socket = fakeSocket()
    bindEvent({ socket, logger: silentLogger }, 'ok', (p) => ({ echo: p }))
    bindEvent({ socket, logger: silentLogger }, 'no', () => {
      throw new AppError(
        404,
        'CONVERSATION_NOT_FOUND',
        'Conversation not found',
      )
    })
    const okAck = vi.fn()
    const noAck = vi.fn()
    socket.trigger('ok', 1, okAck)
    socket.trigger('no', {}, noAck)
    await settle()
    expect(okAck).toHaveBeenCalledExactlyOnceWith({
      success: true,
      data: { echo: 1 },
    })
    expect(noAck).toHaveBeenCalledExactlyOnceWith({
      success: false,
      error: {
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      },
    })
  })

  it('emits ackEvent on success when no callback was given', async () => {
    const socket = fakeSocket()
    bindEvent({ socket, logger: silentLogger }, 'send', () => ({ id: 'm1' }), {
      ackEvent: 'message:ack',
    })
    socket.trigger('send', {})
    await settle()
    expect(socket.emitted).toEqual([['message:ack', { id: 'm1' }]])
  })

  it('answers RATE_LIMITED without running the handler', async () => {
    const socket = fakeSocket()
    const handler = vi.fn()
    const limiter = { consume: (category) => category !== 'message' }
    bindEvent({ socket, logger: silentLogger, limiter }, 'send', handler, {
      limit: 'message',
    })
    const ack = vi.fn()
    socket.trigger('send', {}, ack)
    await settle()
    expect(handler).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledWith({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    })
  })

  it('disconnects after too many invalid payloads', async () => {
    const socket = fakeSocket()
    const { logger, lines } = createMemoryLogger('warn')
    const limiter = { consume: (category) => category !== 'invalid' }
    bindEvent({ socket, logger, limiter }, 'join', () => {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request')
    })
    socket.trigger('join', {})
    await settle()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(lines[0].msg).toBe(
      'socket disconnected after too many invalid events',
    )
  })

  it('hides unexpected errors', async () => {
    const socket = fakeSocket()
    bindEvent({ socket, logger: silentLogger }, 'boom', () => {
      throw new Error('mongo://secret details')
    })
    socket.trigger('boom', {})
    await settle()
    expect(socket.emitted).toEqual([
      ['error', { code: 'INTERNAL_ERROR', message: 'Internal server error' }],
    ])
  })
})

function fakeIo() {
  const calls = []
  const target = (rooms, except) => ({
    except: (id) => target(rooms, id),
    emit: (event, payload) => calls.push({ rooms, except, event, payload }),
  })
  return {
    calls,
    to: (rooms) => target([rooms].flat()),
    emit: (event, payload) => calls.push({ rooms: 'ALL', event, payload }),
    in: (room) => ({
      disconnectSockets: (close) =>
        calls.push({ rooms: [room], disconnect: close }),
    }),
  }
}

describe('realtime hub', () => {
  const conversationService = {
    present: async (list) =>
      list.map((c) => ({
        id: String(c._id),
        type: c.type,
        lastMessageAt: null,
      })),
  }
  const privateConversation = {
    _id: 'c1',
    type: 'private',
    participantIds: ['u1', 'u2'],
  }
  const message = { id: 'm1', createdAt: '2026-01-01T00:00:00.000Z' }

  it('delivers private messages only to the room and participants', async () => {
    const io = fakeIo()
    const hub = createRealtimeHub({ conversationService, logger: silentLogger })
    hub.attach(io)
    await hub.messageCreated({
      conversation: privateConversation,
      message,
      exceptSocketId: 's1',
    })
    expect(io.calls).toEqual([
      {
        rooms: ['conversation:c1'],
        except: 's1',
        event: 'message:new',
        payload: { message },
      },
      {
        rooms: ['user:u1', 'user:u2'],
        except: undefined,
        event: 'conversation:update',
        payload: {
          conversation: {
            id: 'c1',
            type: 'private',
            lastMessageAt: message.createdAt,
          },
        },
      },
    ])
    expect(io.calls.some((c) => c.rooms === 'ALL')).toBe(false)
  })

  it('announces public room activity to everyone', async () => {
    const io = fakeIo()
    const hub = createRealtimeHub({ conversationService, logger: silentLogger })
    hub.attach(io)
    await hub.messageCreated({
      conversation: { _id: 'p', type: 'public', participantIds: [] },
      message,
    })
    expect(io.calls.at(-1)).toMatchObject({
      rooms: 'ALL',
      event: 'conversation:update',
    })
  })

  it('never throws, even when presenting fails', async () => {
    const { logger, lines } = createMemoryLogger('error')
    const hub = createRealtimeHub({
      conversationService: {
        present: async () => {
          throw new Error('db down')
        },
      },
      logger,
    })
    hub.attach(fakeIo())
    await expect(
      hub.messageCreated({ conversation: privateConversation, message }),
    ).resolves.toBeUndefined()
    expect(lines[0].msg).toBe('realtime message notification failed')
  })

  it('is a no-op before attach and disconnects revoked sessions', () => {
    const hub = createRealtimeHub({ conversationService, logger: silentLogger })
    expect(() => hub.sessionRevoked('s1')).not.toThrow()
    const io = fakeIo()
    hub.attach(io)
    hub.sessionRevoked(null)
    hub.sessionRevoked('s1')
    expect(io.calls).toEqual([{ rooms: ['session:s1'], disconnect: true }])
  })
})
