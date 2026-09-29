import { describe, expect, it, vi } from 'vitest'
import {
  createSocketClient,
  SOCKET_OPTIONS,
} from '../src/services/socket/socketClient.js'

describe('createSocketClient', () => {
  it('connects to the configured URL without auto-connecting', () => {
    const socket = { connected: false }
    const ioFactory = vi.fn(() => socket)

    expect(
      createSocketClient({ url: 'https://chat.example.com', ioFactory }),
    ).toBe(socket)
    expect(ioFactory).toHaveBeenCalledWith(
      'https://chat.example.com',
      expect.objectContaining({ autoConnect: false, withCredentials: true }),
    )
  })

  it('uses the page origin when no URL is configured', () => {
    const ioFactory = vi.fn(() => ({}))
    createSocketClient({ ioFactory })
    expect(ioFactory).toHaveBeenCalledWith(
      expect.objectContaining({ autoConnect: false }),
    )
  })

  it('reconnects automatically with bounded backoff', () => {
    expect(SOCKET_OPTIONS).toMatchObject({
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    })
    expect(SOCKET_OPTIONS.reconnectionDelayMax).toBeGreaterThan(
      SOCKET_OPTIONS.reconnectionDelay,
    )
  })

  it('creates a real, disconnected socket.io client by default', () => {
    const socket = createSocketClient({ url: 'http://127.0.0.1:1' })
    try {
      expect(socket.connected).toBe(false)
      expect(socket.io.opts).toMatchObject({
        autoConnect: false,
        reconnectionDelayMax: 10_000,
      })
    } finally {
      socket.close()
    }
  })
})
