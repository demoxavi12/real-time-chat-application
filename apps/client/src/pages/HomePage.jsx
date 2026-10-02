import { useState } from 'react'
import { Link, Outlet, useMatch, useNavigate } from 'react-router'
import { useAuth } from '../features/auth/authContext.js'
import { ConversationList } from '../features/chat/ConversationList.jsx'
import { UserSearch } from '../features/chat/UserSearch.jsx'
import { useConversations } from '../features/chat/useConversations.js'
import { useRealtime } from '../features/realtime/realtimeContext.js'

const CONNECTION_LABELS = {
  connected: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline — messages still send and will sync',
  idle: 'Offline',
}

/**
 * Protected application shell: account bar, conversation list, user search
 * and the selected conversation (nested route via <Outlet>). Durable data is
 * loaded over REST; live updates arrive over Socket.IO.
 */
export function HomePage({ chatApi }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const list = useConversations(chatApi)
  const { status: connection } = useRealtime()
  // On narrow screens the list and the open conversation are separate views.
  const conversationOpen = Boolean(useMatch('/conversations/:conversationId'))
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(null)

  async function handleLogout() {
    setSigningOut(true)
    setError(null)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch {
      setError('Sign out failed. Please try again.')
      setSigningOut(false)
    }
  }

  function openConversation(conversation) {
    list.upsert(conversation)
    navigate(`/conversations/${conversation.id}`)
  }

  return (
    <>
      <section className="card session-bar" aria-label="Account">
        <p>
          Signed in as <strong data-testid="current-user">{user.name}</strong>{' '}
          <span className="muted">({user.email})</span>
        </p>
        <div className="session-actions">
          <span
            className={`connection connection-${connection}`}
            role="status"
            data-testid="connection-status"
          >
            {CONNECTION_LABELS[connection]}
          </span>
          <Link to="/status">System status</Link>
          <button type="button" onClick={handleLogout} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
      <div
        className={`chat-layout${conversationOpen ? ' conversation-open' : ''}`}
      >
        <aside className="card chat-sidebar">
          <ConversationList list={list} currentUserId={user.id} />
          <UserSearch chatApi={chatApi} onOpened={openConversation} />
        </aside>
        <div className="card chat-main">
          <Outlet
            context={{
              chatApi,
              currentUserId: user.id,
              onMessageSent: list.recordMessage,
            }}
          />
        </div>
      </div>
    </>
  )
}
