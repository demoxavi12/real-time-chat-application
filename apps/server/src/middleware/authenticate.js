import { AppError, ErrorCodes } from '../utils/AppError.js'

/**
 * Requires a valid session. On success sets `req.auth = { user, userId,
 * sessionId }`; identity comes only from the verified token, never from the
 * request body, query or params. Renews the cookie when the sliding window
 * says so, and clears it when the token is rejected.
 */
export function createAuthenticate({ authService, authCookie }) {
  return async function authenticate(req, res, next) {
    const token = authCookie.read(req.headers.cookie)
    if (!token) {
      throw new AppError(
        401,
        ErrorCodes.AUTHENTICATION_REQUIRED,
        'Authentication required',
      )
    }

    let result
    try {
      result = await authService.authenticate(token)
    } catch (error) {
      if (error instanceof AppError) authCookie.clear(res)
      throw error
    }

    const { user, claims, renewal } = result
    if (renewal) authCookie.set(res, renewal.token, renewal.expiresAt)
    req.auth = {
      user,
      userId: String(user._id),
      sessionId: claims.sessionId,
    }
    next()
  }
}
