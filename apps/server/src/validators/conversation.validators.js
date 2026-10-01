import { z } from 'zod'
import { MESSAGE_MAX_LENGTH } from '../models/message.model.js'
import {
  cursorSchema,
  limitSchema,
  objectIdSchema,
} from './common.validators.js'

export const CONVERSATION_PAGE = Object.freeze({ fallback: 30, max: 100 })
export const MESSAGE_PAGE = Object.freeze({ fallback: 30, max: 100 })
export const USER_PAGE = Object.freeze({ fallback: 20, max: 50 })
export const USER_QUERY_MAX_LENGTH = 50

/** For routes that take no query parameters: anything present is rejected. */
export const noQuerySchema = z.object({}).strict()

export const conversationParamsSchema = z
  .object({ conversationId: objectIdSchema })
  .strict()

export const listConversationsQuerySchema = z
  .object({
    limit: limitSchema(CONVERSATION_PAGE),
    cursor: cursorSchema.optional(),
  })
  .strict()

// Only the other user's id: the requester is the authenticated user.
export const openPrivateConversationSchema = z
  .object({ userId: objectIdSchema })
  .strict()

export const listMessagesQuerySchema = z
  .object({ limit: limitSchema(MESSAGE_PAGE), before: cursorSchema.optional() })
  .strict()

const TAB = 9
const NEWLINE = 10
const DELETE = 127

/** C0 control characters other than tab and newline, or DEL. */
function hasDisallowedControlCharacter(text) {
  for (const char of text) {
    const code = char.codePointAt(0)
    if ((code < 32 && code !== TAB && code !== NEWLINE) || code === DELETE) {
      return true
    }
  }
  return false
}

/**
 * Message text: line endings normalized, surrounding whitespace trimmed,
 * 1–2000 characters, no control characters other than newline and tab.
 * Stored as plain text; clients must render it as text (never as HTML).
 */
export const messageContentSchema = z
  .string({ error: 'Message content is required' })
  .max(
    MESSAGE_MAX_LENGTH * 2,
    `Message must be at most ${MESSAGE_MAX_LENGTH} characters`,
  )
  .transform((text) => text.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1, 'Message cannot be empty')
      .max(
        MESSAGE_MAX_LENGTH,
        `Message must be at most ${MESSAGE_MAX_LENGTH} characters`,
      )
      .refine(
        (text) => !hasDisallowedControlCharacter(text),
        'Message contains invalid characters',
      ),
  )

export const clientMessageIdSchema = z
  .string({ error: 'clientMessageId must be a string' })
  .regex(
    /^[A-Za-z0-9_-]{8,64}$/,
    'clientMessageId must be 8-64 letters, digits, "-" or "_"',
  )

// `.strict()`: senderId, conversationId, createdAt, readBy... are rejected.
export const sendMessageSchema = z
  .object({
    content: messageContentSchema,
    clientMessageId: clientMessageIdSchema.optional(),
  })
  .strict()

export const listUsersQuerySchema = z
  .object({
    q: z
      .string({ error: 'q must be a string' })
      .trim()
      .min(1, 'q must not be empty')
      .max(
        USER_QUERY_MAX_LENGTH,
        `q must be at most ${USER_QUERY_MAX_LENGTH} characters`,
      )
      .optional(),
    limit: limitSchema(USER_PAGE),
    cursor: cursorSchema.optional(),
  })
  .strict()
