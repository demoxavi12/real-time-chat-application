import { useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { useRealtime } from '../realtime/realtimeContext.js'
import { conversationTitle, describeChatError } from './chatModel.js'
import { MessageComposer } from './MessageComposer.jsx'
import { useMessages } from './useMessages.js'
import { useReadReceipts, useTypingUsers } from './useTypingAndReads.js'

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

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
  const typingUserIds = useTypingUsers(conversationId, currentUserId)
  const wasRead = useReadReceipts({ conversation, messages, currentUserId })
  const [olderError, setOlderError] = useState(null)

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
    setOlderError(null)
    try {
      await loadOlder()
    } catch (loadError) {
      setOlderError(describeChatError(loadError))
    }
  }

  const other = otherParticipant(conversation, currentUserId)
  const lastMine = [...messages]
    .reverse()
    .find((m) => m.sender.id === currentUserId)

  return (
    <section className="conversation" aria-labelledby="conversation-heading">
      <div className="panel-header">
        <h2 id="conversation-heading">
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
      {nextCursor && (
        <button type="button" className="link-button" onClick={handleLoadOlder}>
          Load older messages
        </button>
      )}
      {olderError && <p role="alert">{olderError}</p>}
      {messages.length === 0 ? (
        <p className="muted">No messages yet. Say hello!</p>
      ) : (
        <ol className="message-list" aria-label="Messages">
          {messages.map((message) => (
            <li
              key={message.id}
              className={
                message.sender.id === currentUserId ? 'message mine' : 'message'
              }
            >
              <p className="message-meta">
                <strong>{message.sender.name ?? 'Unknown user'}</strong>{' '}
                <time dateTime={message.createdAt}>
                  {formatTime(message.createdAt)}
                </time>
              </p>
              {/* Rendered as text: React escapes it, never HTML. */}
              <p className="message-content">{message.content}</p>
              {message === lastMine && wasRead(message) && (
                <p className="message-receipt muted">Seen</p>
              )}
            </li>
          ))}
        </ol>
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
    <p className="muted no-conversation">
      Select a conversation, or find someone to message.
    </p>
  )
}
