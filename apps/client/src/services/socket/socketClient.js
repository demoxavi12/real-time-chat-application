import { io } from 'socket.io-client'

export const SOCKET_OPTIONS = Object.freeze({
  // Per docs/08-frontend-spec.md the socket connects only once the user is
  // authenticated, so callers must call `socket.connect()` explicitly.
  autoConnect: false,
  withCredentials: true,
  // Automatic reconnection with bounded exponential backoff.
  reconnection: true,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 10_000,
  randomizationFactor: 0.5,
  timeout: 10_000,
})

/**
 * Creates (but does not connect) the Socket.IO client. `url` undefined means
 * same origin. All socket usage goes through this boundary so auth and
 * lifecycle handling can be added in one place.
 */
export function createSocketClient({ url, ioFactory = io } = {}) {
  return url === undefined
    ? ioFactory({ ...SOCKET_OPTIONS })
    : ioFactory(url, { ...SOCKET_OPTIONS })
}
