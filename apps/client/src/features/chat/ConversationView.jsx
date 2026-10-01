import { useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { conversationTitle, describeChatError } from './chatModel.js'
import { MessageComposer } from './MessageComposer.jsx'
import { useMessages } from './useMessages.js'

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
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

  return (
    <section className="conversation" aria-labelledby="conversation-heading">
      <div className="panel-header">
        <h2 id="conversation-heading">
          {conversationTitle(conversation, currentUserId)}
        </h2>
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
            </li>
          ))}
        </ol>
      )}
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
