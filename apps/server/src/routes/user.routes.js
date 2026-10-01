import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { sendSuccess } from '../utils/response.js'
import { listUsersQuerySchema } from '../validators/conversation.validators.js'

/** Mounted behind `authenticate` (see app.js). */
export function createUserRouter({ userDirectory }) {
  const router = Router()
  router.get(
    '/',
    validate({ query: listUsersQuerySchema }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store')
      sendSuccess(
        res,
        await userDirectory.search(req.auth.userId, req.validated.query),
      )
    },
  )
  return router
}
