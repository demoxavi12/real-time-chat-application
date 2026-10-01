import { NavLink } from 'react-router'
import { conversationTitle, describeChatError } from './chatModel.js'

export function ConversationList({ list, currentUserId }) {
  const { status, conversations, nextCursor, error, reload, loadMore } = list

  return (
    <nav className="conversation-list" aria-labelledby="conversations-heading">
      <div className="panel-header">
        <h2 id="conversations-heading">Conversations</h2>
        <button type="button" className="link-button" onClick={reload}>
          Refresh
        </button>
      </div>
      {status === 'loading' && <p role="status">Loading conversations…</p>}
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
            <li key={conversation.id}>
              <NavLink
                to={`/conversations/${conversation.id}`}
                className="conversation-link"
              >
                <span className="conversation-kind">
                  {conversation.type === 'public' ? 'Public' : 'Private'}
                </span>{' '}
                {conversationTitle(conversation, currentUserId)}
              </NavLink>
            </li>
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
