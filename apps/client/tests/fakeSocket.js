/**
 * In-memory stand-in for a socket.io-client Socket. Tests drive the "server"
 * side with `serverEmit`, `simulateConnect`, `simulateDisconnect`, and
 * configure acknowledgements with `respond(event, fn)`.
 */
export class FakeSocket {
  constructor({ autoConnect = true } = {}) {
    this.connected = false
    this.autoConnect = autoConnect
    this.listeners = new Map()
    this.ioListeners = new Map()
    this.emitted = []
    this.responders = new Map([
      [
        'conversation:join',
        ({ conversationId }) => ({ success: true, data: { conversationId } }),
      ],
      ['presence:list', () => ({ success: true, data: { online: [] } })],
    ])
    this.disconnectCalls = 0
    this.io = {
      on: (event, fn) => this.#add(this.ioListeners, event, fn),
      off: (event) => this.ioListeners.delete(event),
    }
  }

  #add(map, event, fn) {
    const set = map.get(event) ?? new Set()
    set.add(fn)
    map.set(event, set)
  }

  on(event, fn) {
    this.#add(this.listeners, event, fn)
    return this
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn)
    return this
  }

  removeAllListeners() {
    this.listeners.clear()
    return this
  }

  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0
  }

  get totalListeners() {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0)
  }

  connect() {
    if (this.autoConnect) queueMicrotask(() => this.simulateConnect())
    return this
  }

  disconnect() {
    this.disconnectCalls += 1
    this.connected = false
    return this
  }

  emit(event, payload) {
    this.emitted.push({ event, payload })
    return this
  }

  emittedEvents(event) {
    return this.emitted.filter((e) => e.event === event).map((e) => e.payload)
  }

  timeout() {
    return {
      emitWithAck: async (event, payload) => {
        this.emitted.push({ event, payload, ack: true })
        const responder = this.responders.get(event)
        if (!responder) throw new Error('operation has timed out')
        return responder(payload)
      },
    }
  }

  respond(event, fn) {
    this.responders.set(event, fn)
  }

  #fire(map, event, ...args) {
    for (const fn of [...(map.get(event) ?? [])]) fn(...args)
  }

  serverEmit(event, payload) {
    this.#fire(this.listeners, event, payload)
  }

  simulateConnect() {
    this.connected = true
    this.#fire(this.listeners, 'connect')
  }

  simulateDisconnect(reason = 'transport close') {
    this.connected = false
    this.#fire(this.listeners, 'disconnect', reason)
  }

  simulateReconnectAttempt() {
    this.#fire(this.ioListeners, 'reconnect_attempt')
  }

  simulateConnectError(code) {
    const error = new Error(code)
    error.data = { code, message: code }
    this.#fire(this.listeners, 'connect_error', error)
  }
}

/** A createSocket() factory that records every socket it created. */
export function fakeSocketFactory(options) {
  const sockets = []
  const create = () => {
    const socket = new FakeSocket(options)
    sockets.push(socket)
    return socket
  }
  create.sockets = sockets
  create.latest = () => sockets.at(-1)
  return create
}
