import { DuplicateClientMessageError } from '../repositories/message.repository.js'
import { messageCursor, toPage } from './pagination.js'

export function toPublicMessage(message, senderName) {
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    sender: { id: String(message.senderId), name: senderName ?? null },
    content: message.content,
    clientMessageId: message.clientMessageId ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

/**
 * Durable messaging. Callers must already have authorized the conversation
 * (see conversationAccess policy); the sender is always the authenticated
 * user passed in by the controller.
 */
export function createMessageService({ messages, conversations, users }) {
  async function present(list) {
    const ids = [...new Set(list.map((message) => String(message.senderId)))]
    const rows = ids.length ? await users.findNamesByIds(ids) : []
    const names = new Map(rows.map((row) => [String(row._id), row.name]))
    return list.map((message) =>
      toPublicMessage(message, names.get(String(message.senderId))),
    )
  }

  return {
    /**
     * Persists a message. With a `clientMessageId`, retries return the
     * originally stored message (`created: false`) instead of a duplicate.
     */
    async send({ conversation, senderId, content, clientMessageId }) {
      let message
      try {
        message = await messages.create({
          conversationId: conversation._id,
          senderId,
          content,
          clientMessageId,
        })
      } catch (error) {
        if (!(error instanceof DuplicateClientMessageError)) throw error
        const original = await messages.findByClientMessageId({
          conversationId: conversation._id,
          senderId,
          clientMessageId,
        })
        const [presented] = await present([original])
        return { message: presented, created: false }
      }
      await conversations.recordMessage(conversation._id, message.createdAt)
      const [presented] = await present([message])
      return { message: presented, created: true }
    },

    /**
     * One page of history. Returns messages oldest-first within the page;
     * `nextCursor` (or null) fetches the next *older* page.
     */
    async history({ conversation, limit, before }) {
      const position = before
        ? messageCursor.decode(before, conversation._id)
        : undefined
      const rows = await messages.pageBefore(conversation._id, {
        limit: limit + 1,
        before: position,
      })
      const { items, nextCursor } = toPage(rows, limit, messageCursor.encode)
      return { messages: await present(items.reverse()), nextCursor }
    },
  }
}
