import { sendSuccess } from '../utils/response.js'

/** Identity is always `req.auth.userId`; conversations come from the policy. */
export function createConversationController({
  conversationService,
  messageService,
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
      sendSuccess(res, { message }, created ? 201 : 200)
    },
  }
}
