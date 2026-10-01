import { z } from 'zod'
import { decodeCursor, encodeCursor } from '../utils/cursor.js'

const hexId = z.string().regex(/^[0-9a-f]{24}$/)
const millis = z.number().int().nonnegative()

/**
 * Cursor kinds. Each embeds a short kind tag so a cursor from one listing
 * cannot be replayed against another; message cursors also embed their
 * conversation id.
 */
const schemas = {
  users: z.object({ k: z.literal('u'), id: hexId }).strict(),
  conversations: z.object({ k: z.literal('c'), t: millis, id: hexId }).strict(),
  messages: z
    .object({ k: z.literal('m'), c: hexId, t: millis, id: hexId })
    .strict(),
}

export const userCursor = {
  encode: (user) => encodeCursor({ k: 'u', id: String(user._id) }),
  decode: (cursor) => ({ id: decodeCursor(cursor, schemas.users).id }),
}

export const conversationCursor = {
  encode: (conversation) =>
    encodeCursor({
      k: 'c',
      t: conversation.lastActivityAt.getTime(),
      id: String(conversation._id),
    }),
  decode: (cursor) => {
    const { t, id } = decodeCursor(cursor, schemas.conversations)
    return { at: new Date(t), id }
  },
}

export const messageCursor = {
  encode: (message) =>
    encodeCursor({
      k: 'm',
      c: String(message.conversationId),
      t: message.createdAt.getTime(),
      id: String(message._id),
    }),
  /** Rejects cursors issued for a different conversation. */
  decode: (cursor, conversationId) => {
    const position = decodeCursor(
      cursor,
      schemas.messages.refine((p) => p.c === String(conversationId)),
    )
    return { at: new Date(position.t), id: position.id }
  },
}

/**
 * Keyset page helper: callers fetch `limit + 1` rows; the extra row only
 * signals that another page exists and is never returned.
 */
export function toPage(rows, limit, encode) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? encode(items.at(-1)) : null }
}
