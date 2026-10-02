import { Server } from 'socket.io'
import { bindEvent } from './bindEvent.js'
import { createSocketLimiter } from './rateLimit.js'
import { sessionRoom, userRoom } from './rooms.js'

// Matches the HTTP JSON body limit; message content itself is bounded far
// lower by validation (2000 characters).
const MAX_SOCKET_PAYLOAD_BYTES = 100 * 1024
// setTimeout cannot schedule further ahead than ~24.8 days.
const MAX_TIMER_MS = 2 ** 31 - 1

/**
 * Attaches Socket.IO to an HTTP server. `middlewares` (handshake, e.g. auth)
 * are required so a server can never start without them by accident;
 * `handlers` are the event modules (see handlers/index.js). Both are
 * injectable for tests.
 */
export function createSocketServer(
  httpServer,
  { config, logger, middlewares, handlers = [] },
) {
  if (!Array.isArray(middlewares)) {
    throw new TypeError('createSocketServer requires a middlewares array')
  }
  const allowedOrigins = new Set(config.clientOrigins)
  const io = new Server(httpServer, {
    cors: { origin: [...config.clientOrigins], credentials: true },
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    serveClient: false,
    // CORS does not apply to WebSocket upgrades, so browsers would attach the
    // session cookie to a cross-site upgrade (Cross-Site WebSocket
    // Hijacking). Reject any request whose Origin is not an allowed client.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin
      callback(null, !origin || allowedOrigins.has(origin))
    },
  })

  for (const middleware of middlewares) io.use(middleware)

  io.on('connection', (socket) => {
    // Ids only: never message content, cookies or tokens.
    const userId = socket.data.auth?.userId
    logger.debug('socket connected', { socketId: socket.id, userId })
    const limiter = config.socket ? createSocketLimiter(config.socket) : null
    const registered = new Set()
    let expiryTimer

    const auth = socket.data.auth
    if (auth) {
      // Every socket of a user / of a login session, for targeted delivery
      // and for disconnecting on logout.
      socket.join([userRoom(auth.userId), sessionRoom(auth.sessionId)])
      // A socket never outlives its session's absolute lifetime.
      if (auth.sessionExpiresAt) {
        const ms = auth.sessionExpiresAt.getTime() - Date.now()
        expiryTimer = setTimeout(
          () => socket.disconnect(true),
          Math.min(Math.max(ms, 0), MAX_TIMER_MS),
        )
      }
    }

    socket.on('disconnect', (reason) => {
      clearTimeout(expiryTimer)
      logger.debug('socket disconnected', {
        socketId: socket.id,
        userId,
        reason,
      })
    })

    // Events nobody handles still count as invalid traffic.
    socket.onAny((event) => {
      if (limiter && !registered.has(event) && !limiter.consume('invalid')) {
        logger.warn('socket disconnected after too many unknown events', {
          socketId: socket.id,
        })
        socket.disconnect(true)
      }
    })

    const context = {
      io,
      socket,
      logger,
      on: (event, handler, options) => {
        registered.add(event)
        bindEvent({ socket, logger, limiter }, event, handler, options)
      },
    }
    for (const register of handlers) register(context)
  })

  return io
}
