export const MESSAGE_MAX_LENGTH = 2000

/** What to call a conversation from `currentUserId`'s point of view. */
export function conversationTitle(conversation, currentUserId) {
  if (conversation.type === 'public') return conversation.name ?? 'Public room'
  const other = conversation.participants.find((p) => p.id !== currentUserId)
  return other?.name ?? 'Unknown user'
}

/** Server ordering: last message, else creation time; newest first. */
export function activityTime(conversation) {
  return Date.parse(conversation.lastMessageAt ?? conversation.createdAt)
}

export function sortConversations(conversations) {
  return [...conversations].sort(
    (a, b) => activityTime(b) - activityTime(a) || (a.id < b.id ? 1 : -1),
  )
}

/** Inserts/replaces by id and keeps (createdAt, id) chronological order. */
export function mergeMessages(existing, incoming) {
  const byId = new Map(existing.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** Idempotency key for a send; reused if the same draft is retried. */
export function newClientMessageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Mirrors the server rule: trimmed, 1..2000 characters. */
export function validateMessage(content) {
  const text = content.replace(/\r\n?/g, '\n').trim()
  if (!text) return { error: 'Message cannot be empty' }
  if (text.length > MESSAGE_MAX_LENGTH) {
    return { error: `Message must be at most ${MESSAGE_MAX_LENGTH} characters` }
  }
  return { text }
}

const MESSAGES = {
  CONVERSATION_NOT_FOUND:
    'This conversation does not exist or you do not have access to it.',
  USER_NOT_FOUND: 'That user no longer exists.',
  INVALID_PARTICIPANT: 'You cannot start a conversation with yourself.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  NETWORK_ERROR:
    'Unable to reach the server. Check your connection and try again.',
}

export function describeChatError(error) {
  if (error?.code === 'VALIDATION_ERROR' && error.details?.[0]?.message) {
    return error.details[0].message
  }
  return MESSAGES[error?.code] ?? 'Something went wrong. Please try again.'
}
