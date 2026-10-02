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
}) {
  return [
    createConnectionRateLimit(limits),
    createSocketAuthMiddleware({ authService, authCookie, logger }),
  ]
}
