import { sendSuccess } from '../utils/response.js'

/**
 * Identity is always `req.auth.userId`; conversations come from the policy.
 * Real-time notifications run only after the durable write succeeded.
 */
export function createConversationController({
  conversationService,
  messageService,
  realtime,
}) {
  return {
    async list(req, res) {
      const result = await conversationService.listVisibleTo(
        req.auth.userId,
        req.validated.query,
      )
      sendSuccess(res, result)
    },

    async openPrivate(req, res) {
      const { conversation, created } = await conversationService.openPrivate(
        req.auth.userId,
        req.validated.body.userId,
      )
      const [presented] = await conversationService.present([conversation])
      if (created) await realtime.conversationCreated(conversation)
      sendSuccess(res, { conversation: presented }, created ? 201 : 200)
    },

    async get(req, res) {
      const [presented] = await conversationService.present([req.conversation])
      sendSuccess(res, { conversation: presented })
    },

    async listMessages(req, res) {
      const result = await messageService.history({
        conversation: req.conversation,
        ...req.validated.query,
      })
      sendSuccess(res, result)
    },

    async sendMessage(req, res) {
      const { message, created } = await messageService.send({
        conversation: req.conversation,
        senderId: req.auth.userId,
        ...req.validated.body,
      })
      if (created) {
        await realtime.messageCreated({
          conversation: req.conversation,
          message,
        })
      }
      sendSuccess(res, { message }, created ? 201 : 200)
    },
  }
}
