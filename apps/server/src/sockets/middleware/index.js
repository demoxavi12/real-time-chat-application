import { createSocketAuthMiddleware } from './authenticate.js'
import { createConnectionRateLimit } from './connectionRateLimit.js'

/**
 * Socket.IO connection middlewares, applied in order via `io.use()`.
 * Signature: `(socket, next) => void`; call `next(err)` to reject the
 * handshake. Connections are rate limited per IP, then every connection
 * must authenticate (same session as REST).
 */
export function createDefaultMiddlewares({
  authService,
  authCookie,
  logger,
  limits,
  trustProxy = 0,
}) {
  return [
    createConnectionRateLimit({ ...limits, trustProxy }),
    createSocketAuthMiddleware({ authService, authCookie, logger }),
  ]
}
