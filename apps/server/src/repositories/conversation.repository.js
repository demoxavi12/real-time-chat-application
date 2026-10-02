import { isValidObjectId } from 'mongoose'
import { previewOf } from '../utils/preview.js'
import {
  PUBLIC_ROOM_NAME,
  privateKeyFor,
} from '../models/conversation.model.js'

const DUPLICATE_KEY = 11000

/**
 * Inserts `doc` unless a unique index says it already exists, in which case
 * the existing document is returned. The unique index (not the preceding
 * read) is what makes this safe under concurrency: of N simultaneous
 * inserts exactly one succeeds and the rest read the winner.
 */
async function findOrCreate(Model, filter, doc) {
  const existing = await Model.findOne(filter).exec()
  if (existing) return { conversation: existing, created: false }
  try {
    return { conversation: await Model.create(doc), created: true }
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY) throw error
    const winner = await Model.findOne(filter).exec()
    if (!winner) throw error
    return { conversation: winner, created: false }
  }
}

export function createConversationRepository({ Conversation }) {
  return {
    findById(id) {
      if (!isValidObjectId(id)) return Promise.resolve(null)
      return Conversation.findById(id).exec()
    },

    /** Idempotently creates the singleton public room. */
    ensurePublicRoom() {
      return findOrCreate(
        Conversation,
        { type: 'public' },
        { type: 'public', name: PUBLIC_ROOM_NAME },
      )
    },

    /** Returns the pair's private conversation, creating it at most once. */
    openPrivate(requesterId, otherUserId) {
      const privateKey = privateKeyFor(requesterId, otherUserId)
      return findOrCreate(
        Conversation,
        { type: 'private', privateKey },
        {
          type: 'private',
          privateKey,
          participantIds: [requesterId, otherUserId],
          createdBy: requesterId,
        },
      )
    },

    /**
     * Conversations visible to `userId` (the public room plus their private
     * conversations), most recently active first, keyset-paginated on
     * (lastActivityAt, _id).
     */
    listVisibleTo(userId, { limit, after }) {
      const visible = { $or: [{ type: 'public' }, { participantIds: userId }] }
      const filter = after
        ? {
            $and: [
              visible,
              {
                $or: [
                  { lastActivityAt: { $lt: after.at } },
                  { lastActivityAt: after.at, _id: { $lt: after.id } },
                ],
              },
            ],
          }
        : visible
      return Conversation.find(filter)
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(limit)
        .exec()
    },

    /**
     * Records a new message as the conversation's latest activity and
     * preview. Conditional on being newer, so concurrent sends can never move
     * the preview or the sort key backwards.
     */
    recordMessage(conversationId, message) {
      const at = message.createdAt
      return Conversation.updateOne(
        {
          _id: conversationId,
          $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: at } }],
        },
        {
          $set: {
            lastMessageAt: at,
            lastActivityAt: at,
            lastMessage: {
              messageId: message._id,
              senderId: message.senderId,
              preview: previewOf(message.content),
              createdAt: at,
            },
          },
        },
      ).exec()
    },
  }
}
