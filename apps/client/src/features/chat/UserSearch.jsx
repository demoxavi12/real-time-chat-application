import { useState } from 'react'
import { describeChatError } from './chatModel.js'

/** Find another user and open (or reuse) the private conversation with them. */
export function UserSearch({ chatApi, onOpened }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ status: 'idle', users: [], error: null })
  const [openingId, setOpeningId] = useState(null)

  async function search(event) {
    event.preventDefault()
    const q = query.trim()
    if (!q) return
    setState({ status: 'loading', users: [], error: null })
    try {
      const page = await chatApi.searchUsers({ q, limit: 20 })
      setState({ status: 'done', users: page.users, error: null })
    } catch (error) {
      setState({ status: 'error', users: [], error })
    }
  }

  async function open(user) {
    setOpeningId(user.id)
    try {
      onOpened(await chatApi.openPrivateConversation(user.id))
    } catch (error) {
      setState((s) => ({ ...s, status: 'error', error }))
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <section className="user-search" aria-labelledby="user-search-heading">
      <h2 id="user-search-heading">Find people</h2>
      <form onSubmit={search} role="search">
        <label htmlFor="user-search-input">Name or email</label>
        <div className="inline-form">
          <input
            id="user-search-input"
            type="search"
            value={query}
            maxLength={50}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={state.status === 'loading'}>
            Search
          </button>
        </div>
      </form>
      {state.status === 'loading' && <p role="status">Searching…</p>}
      {state.status === 'error' && (
        <p role="alert">{describeChatError(state.error)}</p>
      )}
      {state.status === 'done' && state.users.length === 0 && (
        <p className="muted">No users found.</p>
      )}
      {state.users.length > 0 && (
        <ul aria-label="Search results">
          {state.users.map((user) => (
            <li key={user.id} className="search-result">
              <span>{user.name}</span>
              <button
                type="button"
                onClick={() => open(user)}
                disabled={openingId !== null}
                aria-label={`Message ${user.name}`}
              >
                {openingId === user.id ? 'Opening…' : 'Message'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
