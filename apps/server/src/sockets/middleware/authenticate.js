import { AppError, ErrorCodes } from '../../utils/AppError.js'

function handshakeError(code, message) {
  const error = new Error(code)
  error.data = { code, message }
  return error
}

/**
 * Handshake authentication: the same session cookie and the same
 * authService.authenticate() as REST. Identity is taken only from the
 * verified token; anything in `socket.handshake.auth`/query is ignored.
 * On success `socket.data.auth = { userId, sessionId, name }`.
 */
export function createSocketAuthMiddleware({
  authService,
  authCookie,
  logger,
}) {
  return async (socket, next) => {
    const token = authCookie.read(socket.handshake.headers.cookie)
    if (!token) {
      next(
        handshakeError(
          ErrorCodes.AUTHENTICATION_REQUIRED,
          'Authentication required',
        ),
      )
      return
    }
    try {
      const { user, claims } = await authService.authenticate(token)
      socket.data.auth = {
        userId: String(user._id),
        sessionId: claims.sessionId,
        name: user.name,
      }
      next()
    } catch (error) {
      if (error instanceof AppError) {
        next(handshakeError(error.code, error.message))
        return
      }
      logger.error('socket authentication failed', { err: error })
      next(handshakeError(ErrorCodes.INTERNAL_ERROR, 'Internal server error'))
    }
  }
}
