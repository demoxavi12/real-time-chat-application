import { AppError, ErrorCodes } from '../utils/AppError.js'
import { conversationCursor, toPage } from './pagination.js'

/**
 * Membership rule (single source of truth for REST now and Socket.IO in
 * Phase 3): every authenticated user may use the public room; a private
 * conversation is accessible only to its two participants.
 */
export function canAccessConversation(conversation, userId) {
  if (conversation.type === 'public') return true
  return conversation.participantIds.some((id) => String(id) === String(userId))
}

// Same answer for "does not exist" and "not yours", so ids cannot be probed.
const conversationNotFound = () =>
  new AppError(404, ErrorCodes.CONVERSATION_NOT_FOUND, 'Conversation not found')

async function namesById(users, ids) {
  const unique = [...new Set(ids.map(String))]
  if (unique.length === 0) return new Map()
  const rows = await users.findNamesByIds(unique)
  return new Map(rows.map((row) => [String(row._id), row.name]))
}

export function toPublicConversation(conversation, names) {
  return {
    id: String(conversation._id),
    type: conversation.type,
    name: conversation.name ?? null,
    participants: conversation.participantIds.map((id) => ({
      id: String(id),
      name: names.get(String(id)) ?? null,
    })),
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    lastMessage: conversation.lastMessage
      ? {
          id: String(conversation.lastMessage.messageId),
          sender: {
            id: String(conversation.lastMessage.senderId),
            name: names.get(String(conversation.lastMessage.senderId)) ?? null,
          },
          preview: conversation.lastMessage.preview,
          createdAt: conversation.lastMessage.createdAt.toISOString(),
        }
      : null,
  }
}

export function createConversationService({ conversations, users }) {
  async function present(list) {
    const names = await namesById(
      users,
      list.flatMap((conversation) => [
        ...conversation.participantIds,
        ...(conversation.lastMessage
          ? [conversation.lastMessage.senderId]
          : []),
      ]),
    )
    return list.map((conversation) => toPublicConversation(conversation, names))
  }

  return {
    present,

    /** Throws 404 CONVERSATION_NOT_FOUND unless `userId` may access it. */
    async getAccessible(conversationId, userId) {
      const conversation = await conversations.findById(conversationId)
      if (!conversation || !canAccessConversation(conversation, userId)) {
        throw conversationNotFound()
      }
      return conversation
    },

    /**
     * Opens (finds or creates) the private conversation between the
     * authenticated requester and `otherUserId`. Safe under concurrency.
     */
    async openPrivate(requesterId, otherUserId) {
      if (String(requesterId) === String(otherUserId)) {
        throw new AppError(
          400,
          ErrorCodes.INVALID_PARTICIPANT,
          'You cannot start a private conversation with yourself',
        )
      }
      const other = await users.findById(otherUserId)
      if (!other) {
        throw new AppError(404, ErrorCodes.USER_NOT_FOUND, 'User not found')
      }
      return conversations.openPrivate(requesterId, other._id)
    },

    async listVisibleTo(userId, { limit, cursor }) {
      const after = cursor ? conversationCursor.decode(cursor) : undefined
      const rows = await conversations.listVisibleTo(userId, {
        limit: limit + 1,
        after,
      })
      const { items, nextCursor } = toPage(
        rows,
        limit,
        conversationCursor.encode,
      )
      return { conversations: await present(items), nextCursor }
    },

    /** Ensures the singleton public room exists (called at startup). */
    ensurePublicRoom() {
      return conversations.ensurePublicRoom()
    },
  }
}
