import { Schema } from 'mongoose'

export const CONVERSATION_TYPES = Object.freeze(['public', 'private'])
export const PUBLIC_ROOM_NAME = 'General'
const NAME_MAX_LENGTH = 80

/**
 * Deterministic identity of a private conversation: the two participant ids,
 * sorted. Stored in `privateKey` under a unique index, so the database itself
 * guarantees at most one private conversation per pair (no check-then-insert
 * race).
 */
export function privateKeyFor(userIdA, userIdB) {
  return [String(userIdA), String(userIdB)].sort().join(':')
}

export const conversationSchema = new Schema(
  {
    type: { type: String, enum: CONVERSATION_TYPES, required: true },
    // Public room name; private conversations are named after the other
    // participant by clients.
    name: {
      type: String,
      trim: true,
      maxlength: NAME_MAX_LENGTH,
      default: null,
    },
    participantIds: { type: [Schema.Types.ObjectId], default: [] },
    privateKey: { type: String },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    lastMessageAt: { type: Date, default: null },
    // Denormalized preview of the newest message (for conversation lists,
    // without a per-conversation message query).
    lastMessage: {
      type: new Schema(
        {
          messageId: { type: Schema.Types.ObjectId, required: true },
          senderId: { type: Schema.Types.ObjectId, required: true },
          preview: { type: String, required: true, maxlength: 120 },
          createdAt: { type: Date, required: true },
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    // Sort key for conversation lists: createdAt, then each new message.
    lastActivityAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
)

conversationSchema.pre('validate', function enforceShape() {
  if (this.type === 'private') {
    const ids = this.participantIds.map(String)
    if (ids.length !== 2 || ids[0] === ids[1]) {
      this.invalidate(
        'participantIds',
        'A private conversation needs exactly two different participants',
      )
    } else if (this.privateKey !== privateKeyFor(ids[0], ids[1])) {
      this.invalidate('privateKey', 'privateKey must match the participants')
    }
  } else if (this.participantIds.length > 0 || this.privateKey) {
    this.invalidate(
      'participantIds',
      'The public room is open to every user and has no participant list',
    )
  }
})

// At most one private conversation per user pair.
conversationSchema.index(
  { privateKey: 1 },
  {
    unique: true,
    name: 'private_pair_unique',
    partialFilterExpression: { type: 'private' },
  },
)
// The public room is a singleton.
conversationSchema.index(
  { type: 1 },
  {
    unique: true,
    name: 'public_room_singleton',
    partialFilterExpression: { type: 'public' },
  },
)
// "My conversations, most recently active first" (multikey on participants).
conversationSchema.index(
  { participantIds: 1, lastActivityAt: -1, _id: -1 },
  { name: 'participant_activity' },
)

export function getConversationModel(connection) {
  return (
    connection.models.Conversation ??
    connection.model('Conversation', conversationSchema)
  )
}
