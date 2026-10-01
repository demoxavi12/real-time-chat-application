import { Router } from 'express'
import { createAuthController } from '../controllers/auth.controller.js'
import { createRateLimiter } from '../middleware/rateLimiter.js'
import { validate } from '../middleware/validate.js'
import { loginSchema, registerSchema } from '../validators/auth.validators.js'

export function createAuthRouter({
  authService,
  authCookie,
  authenticate,
  rateLimit,
}) {
  const controller = createAuthController({ authService, authCookie })
  // Separate counters: registrations count every attempt; logins count only
  // failures, so brute force is throttled while normal sign-ins are not.
  const registerLimiter = createRateLimiter(rateLimit)
  const loginLimiter = createRateLimiter({
    ...rateLimit,
    skipSuccessfulRequests: true,
  })

  const router = Router()
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.post(
    '/register',
    registerLimiter,
    validate({ body: registerSchema }),
    controller.register,
  )
  router.post(
    '/login',
    loginLimiter,
    validate({ body: loginSchema }),
    controller.login,
  )
  router.post('/logout', controller.logout)
  router.get('/me', authenticate, controller.me)
  return router
}
