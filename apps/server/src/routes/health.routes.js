import { Router } from 'express'
import { createHealthController } from '../controllers/health.controller.js'

export function createHealthRouter({ readiness }) {
  const controller = createHealthController({ readiness })
  const router = Router()
  router.get('/health', controller.health)
  router.get('/ready', controller.ready)
  return router
}
