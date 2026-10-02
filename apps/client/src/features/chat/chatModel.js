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

const GROUP_WINDOW_MS = 5 * 60_000
const PREVIEW_MAX_LENGTH = 120

const dayKey = (iso) => new Date(iso).toDateString()

/** "Today", "Yesterday" or a short date, in the viewer's locale. */
export function dayLabel(iso, now = new Date()) {
  const day = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (day.toDateString() === now.toDateString()) return 'Today'
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return day.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  })
}

export function timeOfDay(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Compact time for conversation lists: "now", "5m", "3h", or a date. */
export function shortTime(iso, now = Date.now()) {
  const elapsed = Math.max(0, now - Date.parse(iso))
  if (elapsed < 60_000) return 'now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Annotates chronologically ordered messages for rendering: a day label on
 * the first message of each day, and `grouped` when the previous message is
 * from the same sender within five minutes on the same day.
 */
export function groupMessages(messages, now = new Date()) {
  return messages.map((message, index) => {
    const previous = messages[index - 1]
    const newDay =
      !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt)
    const grouped =
      !newDay &&
      previous.sender.id === message.sender.id &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) <
        GROUP_WINDOW_MS
    return {
      message,
      grouped,
      dayLabel: newDay ? dayLabel(message.createdAt, now) : null,
    }
  })
}

/** Same rule as the server's preview: one line, bounded. */
export function previewOf(content) {
  const line = String(content).replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_MAX_LENGTH
    ? `${line.slice(0, PREVIEW_MAX_LENGTH - 1)}…`
    : line
}

/** The conversation list's second line ("You: …", "Bob: …"). */
export function previewText(conversation, currentUserId) {
  const last = conversation.lastMessage
  if (!last) return 'No messages yet'
  const who =
    last.sender.id === currentUserId ? 'You' : (last.sender.name ?? 'Unknown')
  return `${who}: ${last.preview}`
}

/** Latest-message summary built locally from a message I just sent. */
export function lastMessageFrom(message) {
  return {
    id: message.id,
    sender: message.sender,
    preview: previewOf(message.content),
    createdAt: message.createdAt,
  }
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
