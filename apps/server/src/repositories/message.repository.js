const DUPLICATE_KEY = 11000

export class DuplicateClientMessageError extends Error {
  constructor() {
    super('Message with this clientMessageId already exists')
    this.name = 'DuplicateClientMessageError'
  }
}

export function createMessageRepository({ Message }) {
  return {
    async create({ conversationId, senderId, content, clientMessageId }) {
      try {
        return await Message.create({
          conversationId,
          senderId,
          content,
          ...(clientMessageId && { clientMessageId }),
          readBy: [senderId],
        })
      } catch (error) {
        if (error?.code === DUPLICATE_KEY)
          throw new DuplicateClientMessageError()
        throw error
      }
    },

    findByClientMessageId({ conversationId, senderId, clientMessageId }) {
      return Message.findOne({
        conversationId,
        senderId,
        clientMessageId,
      }).exec()
    },

    /**
     * Atomically adds `userId` to the message's readBy set. Returns null if
     * the message does not exist in this conversation, otherwise whether the
     * set changed (false for a repeated read).
     */
    async addReader({ conversationId, messageId, userId }) {
      const result = await Message.updateOne(
        { _id: messageId, conversationId },
        { $addToSet: { readBy: userId } },
      ).exec()
      if (result.matchedCount === 0) return null
      return result.modifiedCount === 1
    },

    /**
     * One page of a conversation's history, newest first, strictly older
     * than `before` = { at, id } in (createdAt, _id) order. Uses the
     * conversation_history index; `limit` is always bounded by the caller.
     */
    pageBefore(conversationId, { limit, before }) {
      const filter = { conversationId }
      if (before) {
        filter.$or = [
          { createdAt: { $lt: before.at } },
          { createdAt: before.at, _id: { $lt: before.id } },
        ]
      }
      return Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean()
        .exec()
    },
  }
}
