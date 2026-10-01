import { useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../features/auth/authContext.js'
import { ConversationList } from '../features/chat/ConversationList.jsx'
import { UserSearch } from '../features/chat/UserSearch.jsx'
import { useConversations } from '../features/chat/useConversations.js'

/**
 * Protected application shell: account bar, conversation list, user search
 * and the selected conversation (nested route via <Outlet>). Data is loaded
 * over REST; live updates arrive with Socket.IO in Phase 3.
 */
export function HomePage({ chatApi }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const list = useConversations(chatApi)
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
      <div className="chat-layout">
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
