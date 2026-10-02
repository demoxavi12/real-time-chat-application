import { memo, useId } from 'react'
import { NavLink } from 'react-router'
import { useRealtime } from '../realtime/realtimeContext.js'
import {
  conversationTitle,
  describeChatError,
  previewText,
  shortTime,
} from './chatModel.js'

const ConversationItem = memo(function ConversationItem({
  conversation,
  currentUserId,
  online,
}) {
  const title = conversationTitle(conversation, currentUserId)
  const id = useId()
  const activity = conversation.lastMessageAt ?? conversation.createdAt
  return (
    <li>
      <NavLink
        to={`/conversations/${conversation.id}`}
        className="conversation-link"
        // Name = the conversation title only; kind, presence, time and
        // preview are its description (so preview text never changes how
        // the link is named).
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-meta ${id}-preview`}
      >
        <span className="conversation-line">
          <span className="conversation-kind" id={`${id}-meta`}>
            {conversation.type === 'public' ? 'Public' : 'Private'}
          </span>{' '}
          <span className="conversation-title" id={`${id}-title`}>
            {title}
          </span>
          {online && (
            <span className="online-badge">
              <span aria-hidden="true" className="presence-dot" /> (online)
            </span>
          )}
          <time className="conversation-time muted" dateTime={activity}>
            {shortTime(activity)}
          </time>
        </span>
        <span className="conversation-preview muted" id={`${id}-preview`}>
          {previewText(conversation, currentUserId)}
        </span>
      </NavLink>
    </li>
  )
})

export function ConversationList({ list, currentUserId }) {
  const { status, conversations, nextCursor, error, reload, loadMore } = list
  const { isOnline } = useRealtime()
  const otherId = (conversation) =>
    conversation.participants.find((p) => p.id !== currentUserId)?.id

  return (
    <nav className="conversation-list" aria-labelledby="conversations-heading">
      <div className="panel-header">
        <h2 id="conversations-heading">Conversations</h2>
        <button type="button" className="link-button" onClick={reload}>
          Refresh
        </button>
      </div>
      {status === 'loading' && conversations.length === 0 && (
        <p role="status">Loading conversations…</p>
      )}
      {status === 'error' && (
        <div role="alert">
          <p>{describeChatError(error)}</p>
          <button type="button" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {status === 'ready' && conversations.length === 0 && (
        <p className="muted">No conversations yet.</p>
      )}
      {conversations.length > 0 && (
        <ul>
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              currentUserId={currentUserId}
              online={
                conversation.type === 'private' &&
                isOnline(otherId(conversation))
              }
            />
          ))}
        </ul>
      )}
      {nextCursor && (
        <button type="button" className="link-button" onClick={loadMore}>
          More conversations
        </button>
      )}
    </nav>
  )
}
