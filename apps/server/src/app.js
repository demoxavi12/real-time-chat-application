import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { createRateLimiter } from './middleware/rateLimiter.js'
import { requestId } from './middleware/requestId.js'
import { requestLogger } from './middleware/requestLogger.js'
import { createHealthRouter } from './routes/health.routes.js'

export const JSON_BODY_LIMIT = '100kb'

/**
 * Builds the Express application. Pure construction: no network or database
 * side effects, so it can be tested with injected dependencies.
 */
export function createApp({ config, logger, readiness }) {
  const app = express()
  app.disable('x-powered-by')

  app.use(requestId())
  app.use(requestLogger(logger))
  app.use(helmet())
  app.use(cors({ origin: [...config.clientOrigins], credentials: true }))
  app.use(express.json({ limit: JSON_BODY_LIMIT }))

  // Probes are exposed at the root (for orchestrators/load balancers) and
  // under /api (for the client's API base URL). They are not rate limited.
  const healthRouter = createHealthRouter({ readiness })
  app.use(healthRouter)

  const api = express.Router()
  api.use(healthRouter)
  api.use(createRateLimiter(config.rateLimit))
  // Feature routers (auth, users, conversations, messages) mount here.
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler(logger))
  return app
}
