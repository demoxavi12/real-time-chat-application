import { ErrorCodes } from '../utils/AppError.js'
import { sendError, sendSuccess } from '../utils/response.js'

export function createHealthController({ readiness }) {
  return {
    /** Liveness: the process is up and serving HTTP. No dependency checks. */
    health(_req, res) {
      res.set('Cache-Control', 'no-store')
      sendSuccess(res, {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      })
    },

    /** Readiness: every required dependency (MongoDB, ...) is reachable now. */
    async ready(_req, res) {
      res.set('Cache-Control', 'no-store')
      const { ready, checks } = await readiness.check()
      if (ready) {
        sendSuccess(res, { status: 'ready', checks })
        return
      }
      sendError(res, 503, {
        code: ErrorCodes.NOT_READY,
        message: 'Service is not ready',
        details: Object.entries(checks).map(([check, status]) => ({
          check,
          status,
        })),
      })
    },
  }
}
