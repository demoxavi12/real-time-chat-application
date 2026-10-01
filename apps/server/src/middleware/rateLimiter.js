import { rateLimit } from 'express-rate-limit'
import { AppError, ErrorCodes } from '../utils/AppError.js'

/**
 * Per-IP limiter factory used for the baseline API limit and for the
 * stricter authentication limits. `skipSuccessfulRequests` counts only
 * responses with status >= 400 (used for login).
 */
export function createRateLimiter({
  windowMs,
  max,
  skipSuccessfulRequests = false,
}) {
  return rateLimit({
    windowMs,
    limit: max,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, ErrorCodes.RATE_LIMITED, 'Too many requests')),
  })
}
