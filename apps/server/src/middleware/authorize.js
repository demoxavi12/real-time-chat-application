import { AppError, ErrorCodes } from '../utils/AppError.js'

/**
 * Authorization foundation. Routes compose
 *   authenticate -> authorize(policy) -> controller
 * where `policy(req)` returns (or resolves) true when `req.auth` may perform
 * the request, e.g. a future conversation-membership check. Policies receive
 * the verified identity via `req.auth`; they must not read identity from the
 * client payload.
 */
export function authorize(policy) {
  return async function authorizeRequest(req, _res, next) {
    if (!req.auth) {
      throw new AppError(
        401,
        ErrorCodes.AUTHENTICATION_REQUIRED,
        'Authentication required',
      )
    }
    if (!(await policy(req))) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Not authorized')
    }
    next()
  }
}
