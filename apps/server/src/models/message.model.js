import { Schema } from 'mongoose'

export const MESSAGE_MAX_LENGTH = 2000

export const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    // Always the authenticated user; never taken from client input.
    senderId: { type: Schema.Types.ObjectId, required: true },
    // Optional client-generated id that makes retries idempotent.
    clientMessageId: { type: String },
    content: { type: String, required: true, maxlength: MESSAGE_MAX_LENGTH },
    // Read-state foundation (docs/04): users who have read the message. The
    // sender is added on creation; marking messages read is Phase 3.
    readBy: { type: [Schema.Types.ObjectId], default: [] },
  },
  {
    // Server-generated creation time only; messages are immutable.
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
    autoIndex: false,
  },
)

// History + cursor pagination: newest first with _id as the tie-breaker for
// identical timestamps.
messageSchema.index(
  { conversationId: 1, createdAt: -1, _id: -1 },
  { name: 'conversation_history' },
)
// Retry deduplication: one message per (conversation, sender, clientMessageId).
messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  {
    unique: true,
    name: 'client_message_id_unique',
    partialFilterExpression: { clientMessageId: { $type: 'string' } },
  },
)

export function getMessageModel(connection) {
  return connection.models.Message ?? connection.model('Message', messageSchema)
}
