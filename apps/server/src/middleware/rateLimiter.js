import { rateLimit } from 'express-rate-limit'
import { AppError, ErrorCodes } from '../utils/AppError.js'

/**
 * Baseline per-IP limiter for the API. Stricter, route-specific limiters
 * (e.g. login) should be created with this same factory.
 */
export function createRateLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, ErrorCodes.RATE_LIMITED, 'Too many requests')),
  })
}
