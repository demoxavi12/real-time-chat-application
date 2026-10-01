import { Router } from 'express'
import { createConversationController } from '../controllers/conversation.controller.js'
import { authorize } from '../middleware/authorize.js'
import { validate } from '../middleware/validate.js'
import { conversationAccess } from '../policies/conversationAccess.policy.js'
import {
  conversationParamsSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  noQuerySchema,
  openPrivateConversationSchema,
  sendMessageSchema,
} from '../validators/conversation.validators.js'

/** Mounted behind `authenticate` (see app.js). */
export function createConversationRouter({
  conversationService,
  messageService,
}) {
  const controller = createConversationController({
    conversationService,
    messageService,
  })
  const canAccess = authorize(conversationAccess(conversationService))
  const params = validate({ params: conversationParamsSchema })

  const router = Router()
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.get(
    '/',
    validate({ query: listConversationsQuerySchema }),
    controller.list,
  )
  router.post(
    '/private',
    validate({ query: noQuerySchema, body: openPrivateConversationSchema }),
    controller.openPrivate,
  )
  router.get(
    '/:conversationId',
    params,
    canAccess,
    validate({ query: noQuerySchema }),
    controller.get,
  )
  router.get(
    '/:conversationId/messages',
    params,
    canAccess,
    validate({ query: listMessagesQuerySchema }),
    controller.listMessages,
  )
  router.post(
    '/:conversationId/messages',
    params,
    canAccess,
    validate({ query: noQuerySchema, body: sendMessageSchema }),
    controller.sendMessage,
  )
  return router
}
