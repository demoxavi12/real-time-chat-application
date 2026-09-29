import { AppError, ErrorCodes, toPublicError } from '../utils/AppError.js'
import { sendError } from '../utils/response.js'

// Translates body-parser failures into client errors instead of 500s.
function normalize(error) {
  if (error?.type === 'entity.parse.failed') {
    return new AppError(400, ErrorCodes.INVALID_JSON, 'Malformed JSON body')
  }
  if (error?.type === 'entity.too.large') {
    return new AppError(
      413,
      ErrorCodes.PAYLOAD_TOO_LARGE,
      'Request body too large',
    )
  }
  return error
}

/**
 * Central error handler. Responses never contain stack traces or internal
 * error messages; unexpected errors are logged server-side with the request id.
 */
export function errorHandler(logger) {
  // Express identifies error middleware by its four-argument signature.
  return (error, req, res, _next) => {
    const normalized = normalize(error)
    const { statusCode, body } = toPublicError(normalized)
    if (statusCode >= 500) {
      logger.error('unhandled request error', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        err: normalized,
      })
    }
    if (res.headersSent) {
      res.destroy()
      return
    }
    sendError(res, statusCode, body)
  }
}
