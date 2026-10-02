import { z } from 'zod'
import { objectIdSchema } from './common.validators.js'
import {
  clientMessageIdSchema,
  messageContentSchema,
} from './conversation.validators.js'

// Socket payloads mirror docs/06-websocket-protocol.md exactly and are
// strict: unknown keys (senderId, authorized, userId, ...) are rejected.

export const conversationEventSchema = z
  .object({ conversationId: objectIdSchema })
  .strict()

// Same content and clientMessageId rules as REST; the id is required here
// because sockets have no other retry/ack correlation.
export const socketSendMessageSchema = z
  .object({
    conversationId: objectIdSchema,
    clientMessageId: clientMessageIdSchema,
    content: messageContentSchema,
  })
  .strict()

export const readMessageSchema = z
  .object({ conversationId: objectIdSchema, messageId: objectIdSchema })
  .strict()
