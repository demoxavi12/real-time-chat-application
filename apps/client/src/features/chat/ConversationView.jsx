import { memo, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { useAuth } from '../auth/authContext.js'
import { useRealtime } from '../realtime/realtimeContext.js'
import {
  conversationTitle,
  describeChatError,
  groupMessages,
  timeOfDay,
} from './chatModel.js'
import { MessageComposer } from './MessageComposer.jsx'
import { useChatScroll } from './useChatScroll.js'
import { useMessages } from './useMessages.js'
import { useReadReceipts, useTypingUsers } from './useTypingAndReads.js'

function otherParticipant(conversation, currentUserId) {
  return conversation.type === 'private'
    ? conversation.participants.find((p) => p.id !== currentUserId)
    : null
}

function TypingIndicator({ conversation, typingUserIds }) {
  if (typingUserIds.size === 0) return null
  const names = [...typingUserIds].map(
    (id) =>
      conversation.participants.find((p) => p.id === id)?.name ?? 'Someone',
  )
  return (
    <p className="typing-indicator muted" role="status">
      {names.length === 1
        ? `${names[0]} is typing…`
        : 'Several people are typing…'}
    </p>
  )
}

const MessageItem = memo(function MessageItem({
  message,
  mine,
  grouped,
  dayLabel,
  status,
}) {
  const time = timeOfDay(message.createdAt)
  const sender = message.sender.name ?? 'Unknown user'
  return (
    <li
      className={[
        'message',
        mine ? 'mine' : 'theirs',
        grouped ? 'grouped' : '',
      ].join(' ')}
    >
      {dayLabel && (
        <p className="day-divider">
          <span>{dayLabel}</span>
        </p>
      )}
      {grouped ? (
        // Visually grouped under the previous message; still announced.
        <span className="visually-hidden">{sender}</span>
      ) : (
        <p className="message-meta">
          <strong>{mine ? 'You' : sender}</strong>
          {mine && <span className="visually-hidden"> ({sender})</span>}{' '}
          <time dateTime={message.createdAt}>{time}</time>
        </p>
      )}
      {/* Rendered as text: React escapes it, never HTML. */}
      <p className="message-content" title={grouped ? time : undefined}>
        {message.content}
      </p>
      {status && <p className="message-receipt muted">{status}</p>}
    </li>
  )
})

function Conversation({
  chatApi,
  conversationId,
  currentUserId,
  onMessageSent,
}) {
  const {
    status,
    conversation,
    messages,
    nextCursor,
    error,
    refresh,
    loadOlder,
    addMessage,
  } = useMessages(chatApi, conversationId)
  const { isOnline } = useRealtime()
  const { handleAuthError } = useAuth()
  const typingUserIds = useTypingUsers(conversationId, currentUserId)
  const wasRead = useReadReceipts({ conversation, messages, currentUserId })
  const [older, setOlder] = useState({ loading: false, error: null })
  const { containerRef, onScroll, hasUnseenNew, scrollToBottom } =
    useChatScroll(messages, currentUserId)
  const headingRef = useRef(null)
  const ready = status === 'ready'

  // Move focus to the conversation heading when it opens, so keyboard and
  // screen-reader users land in the right place.
  useEffect(() => {
    if (ready) headingRef.current?.focus({ preventScroll: true })
  }, [ready])

  if (status === 'loading') {
    return <p role="status">Loading conversation…</p>
  }
  if (status === 'notFound') {
    return (
      <div role="alert" className="card">
        <h2>Conversation not found</h2>
        <p>{describeChatError({ code: 'CONVERSATION_NOT_FOUND' })}</p>
        <Link to="/">Back to your conversations</Link>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div role="alert" className="card">
        <p>{describeChatError(error)}</p>
        <button type="button" onClick={refresh}>
          Try again
        </button>
      </div>
    )
  }

  async function handleLoadOlder() {
    setOlder({ loading: true, error: null })
    try {
      await loadOlder()
      setOlder({ loading: false, error: null })
    } catch (loadError) {
      if (handleAuthError(loadError)) return
      setOlder({ loading: false, error: describeChatError(loadError) })
    }
  }

  const other = otherParticipant(conversation, currentUserId)
  const lastMine = [...messages]
    .reverse()
    .find((m) => m.sender.id === currentUserId)
  const deliveryStatus = (message) => {
    if (message !== lastMine) return null
    if (conversation.type !== 'private') return 'Sent'
    return message.seen || wasRead(message) ? 'Seen' : 'Sent'
  }

  return (
    <section className="conversation" aria-labelledby="conversation-heading">
      <div className="panel-header conversation-header">
        <Link to="/" className="back-link">
          <span aria-hidden="true">←</span> Back to conversations
        </Link>
        <h2 id="conversation-heading" ref={headingRef} tabIndex={-1}>
          {conversationTitle(conversation, currentUserId)}
        </h2>
        {other && (
          <span className="presence muted" data-testid="conversation-presence">
            {isOnline(other.id) ? 'Online' : 'Offline'}
          </span>
        )}
        <button type="button" className="link-button" onClick={refresh}>
          Refresh
        </button>
      </div>

      <div
        className="message-scroll"
        ref={containerRef}
        onScroll={onScroll}
        role="log"
        aria-label="Message history"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {nextCursor && (
          <button
            type="button"
            className="link-button load-older"
            onClick={handleLoadOlder}
            disabled={older.loading}
          >
            {older.loading ? 'Loading older messages…' : 'Load older messages'}
          </button>
        )}
        {older.error && <p role="alert">{older.error}</p>}
        {messages.length === 0 ? (
          <p className="muted">No messages yet. Say hello!</p>
        ) : (
          <ol className="message-list" aria-label="Messages">
            {groupMessages(messages).map(({ message, grouped, dayLabel }) => (
              <MessageItem
                key={message.id}
                message={message}
                mine={message.sender.id === currentUserId}
                grouped={grouped}
                dayLabel={dayLabel}
                status={deliveryStatus(message)}
              />
            ))}
          </ol>
        )}
      </div>
      {hasUnseenNew && (
        <button type="button" className="new-messages" onClick={scrollToBottom}>
          New messages <span aria-hidden="true">↓</span>
        </button>
      )}

      <TypingIndicator
        conversation={conversation}
        typingUserIds={typingUserIds}
      />
      <MessageComposer
        chatApi={chatApi}
        conversationId={conversationId}
        onSent={(message) => {
          addMessage(message)
          onMessageSent(message)
        }}
      />
    </section>
  )
}

/** Route element for /conversations/:conversationId. */
export function ConversationView() {
  const { conversationId } = useParams()
  const { chatApi, currentUserId, onMessageSent } = useOutletContext()
  return (
    <Conversation
      key={conversationId}
      chatApi={chatApi}
      conversationId={conversationId}
      currentUserId={currentUserId}
      onMessageSent={onMessageSent}
    />
  )
}

/** Route element for / (no conversation selected). */
export function NoConversationSelected() {
  return (
    <div className="no-conversation">
      <h2>Welcome</h2>
      <p className="muted">
        Select a conversation, join the public room, or find someone to message.
      </p>
    </div>
  )
}
