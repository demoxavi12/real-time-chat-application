/**
 * Socket.IO connection middlewares, applied in order via `io.use()`.
 * Signature: `(socket, next) => void`; call `next(err)` to reject the
 * handshake. JWT handshake authentication is added here in Phase 3.
 */
export const defaultMiddlewares = []
