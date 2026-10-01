import { AppError, ErrorCodes } from '../utils/AppError.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence in depth for cookie authentication (alongside SameSite).
 * Browsers attach an Origin header to every cross-origin (and modern
 * same-origin) state-changing request; if it is present it must be one of
 * the configured client origins. Requests without Origin (non-browser
 * clients) cannot carry a victim's cookies through a browser, so they pass.
 */
export function requireAllowedOrigin(allowedOrigins) {
  const allowed = new Set(allowedOrigins)
  return (req, _res, next) => {
    const origin = req.get('origin')
    if (SAFE_METHODS.has(req.method) || !origin || allowed.has(origin)) {
      next()
      return
    }
    next(new AppError(403, ErrorCodes.ORIGIN_NOT_ALLOWED, 'Origin not allowed'))
  }
}
