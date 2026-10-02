import { io as connectClient } from 'socket.io-client'

/**
 * Socket.IO test clients with deterministic, event-driven helpers (no
 * sleeps). Call `closeAll()` in afterEach.
 */
const clients = new Set()

export function connectSocket(url, cookie, options = {}) {
  const client = connectClient(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...(cookie && { extraHeaders: { cookie } }),
    ...options,
  })
  // Record everything the client receives, in order.
  client.received = []
  client.onAny((event, payload) => client.received.push({ event, payload }))
  clients.add(client)
  return client
}

export function closeAll() {
  for (const client of clients) client.disconnect()
  clients.clear()
}

/** Resolves on `connect`, rejects with the connect_error. */
export function connected(client) {
  if (client.connected) return Promise.resolve(client)
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client))
    client.once('connect_error', reject)
  })
}

export async function connectAs(url, user, options) {
  return connected(connectSocket(url, user.cookie, options))
}

/** Emits with an acknowledgement and returns the server's envelope. */
export function request(client, event, payload) {
  return payload === undefined
    ? client.timeout(5000).emitWithAck(event)
    : client.timeout(5000).emitWithAck(event, payload)
}

export async function join(client, conversationId) {
  const reply = await request(client, 'conversation:join', { conversationId })
  if (!reply.success) throw new Error(`join failed: ${JSON.stringify(reply)}`)
  return reply
}

/** Resolves with the next `event` payload that matches `predicate`. */
export function nextEvent(client, event, predicate = () => true) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      if (!predicate(payload)) return
      client.off(event, handler)
      resolve(payload)
    }
    client.on(event, handler)
  })
}

/**
 * Ordering barrier: a round trip on the same connection. Socket.IO keeps
 * per-connection order, so anything the server emitted to this client
 * before handling the barrier has arrived once it resolves.
 */
export function barrier(client) {
  return request(client, 'presence:list')
}

export function receivedEvents(client, event) {
  return client.received.filter((r) => r.event === event).map((r) => r.payload)
}

export function disconnected(client) {
  return new Promise((resolve) => client.once('disconnect', resolve))
}
