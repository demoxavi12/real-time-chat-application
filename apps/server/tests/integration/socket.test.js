import { io as connectClient } from 'socket.io-client'
import request from 'supertest'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { z } from 'zod'
import { startServer } from '../../src/server.js'
import { AppError } from '../../src/utils/AppError.js'
import { parseWithSchema } from '../../src/validators/parseWithSchema.js'
import {
  createMemoryLogger,
  TEST_ORIGIN,
  testConfig,
  uniqueDbName,
  withDatabase,
} from '../helpers/testEnv.js'

// Test-only handler module exercising the handler registry and the
// centralized error handling. It is injected; the app registers no events.
function testHandlers({ on }) {
  on('test:echo', (payload) => ({ echoed: payload }))
  on('test:validated', (payload) =>
    parseWithSchema(z.object({ text: z.string().max(5) }), payload),
  )
  on('test:forbidden', () => {
    throw new AppError(403, 'FORBIDDEN', 'Not authorized')
  })
  on('test:crash', async () => {
    throw new Error('internal detail that must not leak')
  })
}

const clients = []
let server

async function boot({ middlewares, handlers = [testHandlers] } = {}) {
  const { logger, lines } = createMemoryLogger('debug')
  server = await startServer({
    config: testConfig({
      MONGODB_URI: withDatabase(inject('mongoUri'), uniqueDbName('sock')),
    }),
    logger,
    socket: { handlers, ...(middlewares && { middlewares }) },
  })
  return { url: `http://127.0.0.1:${server.port}`, lines }
}

function connect(url, options = {}) {
  const client = connectClient(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...options,
  })
  clients.push(client)
  return client
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve))
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect()
  await server?.close()
  server = undefined
})

describe('Socket.IO connection lifecycle', () => {
  it('accepts connections and tracks disconnects', async () => {
    const { url, lines } = await boot()
    const client = connect(url)
    await once(client, 'connect')
    expect(client.connected).toBe(true)
    expect(server.io.of('/').sockets.size).toBe(1)

    client.disconnect()
    await waitFor(() => server.io.of('/').sockets.size === 0)
    await waitFor(() => lines.some((l) => l.msg === 'socket disconnected'))
    expect(lines.find((l) => l.msg === 'socket connected')).toMatchObject({
      socketId: client.id ?? expect.any(String),
    })
  })

  it('supports the HTTP long-polling transport', async () => {
    const { url } = await boot()
    const client = connect(url, { transports: ['polling'] })
    await once(client, 'connect')
    expect(client.io.engine.transport.name).toBe('polling')
  })

  it('disconnects clients during graceful shutdown without banning reconnects', async () => {
    const { url } = await boot()
    const client = connect(url)
    await once(client, 'connect')
    const disconnected = once(client, 'disconnect')
    await server.close()
    server = undefined
    // A transport-level close (not 'io server disconnect') lets real clients
    // reconnect automatically to the restarted/redeployed server.
    await expect(disconnected).resolves.toBe('transport close')
    expect(client.active).toBe(true)
  })

  it('does not register any application events in Phase 0', async () => {
    const { url } = await boot({ handlers: undefined })
    const client = connect(url)
    await once(client, 'connect')
    const reply = client.timeout(300).emitWithAck('message:send', {})
    await expect(reply).rejects.toThrow('operation has timed out')
  })
})

describe('Socket.IO middleware boundary', () => {
  it('rejects handshakes refused by a connection middleware', async () => {
    const { url } = await boot({
      middlewares: [
        (socket, next) => {
          if (socket.handshake.auth?.token === 'let-me-in') next()
          else next(new Error('UNAUTHORIZED'))
        },
      ],
    })

    const rejected = connect(url)
    const error = await once(rejected, 'connect_error')
    expect(error.message).toBe('UNAUTHORIZED')
    expect(rejected.connected).toBe(false)

    const accepted = connect(url, { auth: { token: 'let-me-in' } })
    await once(accepted, 'connect')
    expect(accepted.connected).toBe(true)
  })
})

describe('Socket.IO event error handling', () => {
  async function connected() {
    const { url, lines } = await boot()
    const client = connect(url)
    await once(client, 'connect')
    return { client, lines }
  }

  it('acknowledges successful handlers with a success envelope', async () => {
    const { client } = await connected()
    await expect(client.emitWithAck('test:echo', { a: 1 })).resolves.toEqual({
      success: true,
      data: { echoed: { a: 1 } },
    })
  })

  it('returns VALIDATION_ERROR for invalid payloads', async () => {
    const { client } = await connected()
    const reply = await client.emitWithAck('test:validated', {
      text: 'too long',
    })
    expect(reply).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: [{ path: 'text', message: expect.any(String) }],
      },
    })
  })

  it('returns the AppError code for expected failures', async () => {
    const { client } = await connected()
    await expect(client.emitWithAck('test:forbidden')).resolves.toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Not authorized' },
    })
  })

  it('hides unexpected errors from clients and logs them', async () => {
    const { client, lines } = await connected()
    const reply = await client.emitWithAck('test:crash')
    expect(reply).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(JSON.stringify(reply)).not.toContain('internal detail')
    expect(lines.find((l) => l.msg === 'socket event failed')).toMatchObject({
      level: 'error',
      event: 'test:crash',
    })
  })

  it('emits an `error` event when the client did not request an ack', async () => {
    const { client } = await connected()
    const errorEvent = once(client, 'error')
    client.emit('test:forbidden')
    await expect(errorEvent).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'Not authorized',
    })
    expect(client.connected).toBe(true)
  })
})

describe('Socket.IO CORS', () => {
  const handshakePath = '/socket.io/?EIO=4&transport=polling'

  it('allows the configured client origin', async () => {
    const { url } = await boot()
    const res = await request(url).get(handshakePath).set('Origin', TEST_ORIGIN)
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN)
  })

  it('does not grant other origins', async () => {
    const { url } = await boot()
    const res = await request(url)
      .get(handshakePath)
      .set('Origin', 'https://evil.example.com')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
