/**
 * Error with a stable, client-safe `code` and HTTP status. Anything thrown
 * that is NOT an AppError is treated as unexpected and reported generically.
 */
export class AppError extends Error {
  constructor(statusCode, code, message, details = []) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export const ErrorCodes = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHENTICATION_INVALID: 'AUTHENTICATION_INVALID',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  FORBIDDEN: 'FORBIDDEN',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_PARTICIPANT: 'INVALID_PARTICIPANT',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  NOT_READY: 'NOT_READY',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
})

/** Maps any thrown value to the public `{ code, message, details }` shape. */
export function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        code: error.code,
        message: error.message,
        ...(error.details.length > 0 && { details: error.details }),
      },
    }
  }
  return {
    statusCode: 500,
    body: { code: ErrorCodes.INTERNAL_ERROR, message: 'Internal server error' },
  }
}
