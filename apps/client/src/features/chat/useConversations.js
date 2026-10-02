import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext.js'
import { useRealtimeEvent } from '../realtime/realtimeContext.js'
import { lastMessageFrom, sortConversations } from './chatModel.js'

const PAGE_SIZE = 50

/**
 * The signed-in user's conversation list: loaded over REST, kept current by
 * `conversation:update` events, and silently refetched after a reconnect.
 */
export function useConversations(chatApi) {
  const { handleAuthError } = useAuth()
  const [state, setState] = useState({
    status: 'loading',
    conversations: [],
    nextCursor: null,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    chatApi
      .listConversations({ limit: PAGE_SIZE }, { signal: controller.signal })
      .then(
        (page) =>
          setState({
            status: 'ready',
            conversations: page.conversations,
            nextCursor: page.nextCursor,
            error: null,
          }),
        (error) => {
          if (error?.name === 'AbortError' || handleAuthError(error)) return
          setState((s) => ({ ...s, status: 'error', error }))
        },
      )
    return () => controller.abort()
  }, [chatApi, attempt, handleAuthError])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    setAttempt((n) => n + 1)
  }, [])

  const loadMore = useCallback(async () => {
    const page = await chatApi.listConversations({
      limit: PAGE_SIZE,
      cursor: state.nextCursor,
    })
    setState((s) => {
      const known = new Set(s.conversations.map((c) => c.id))
      return {
        ...s,
        conversations: [
          ...s.conversations,
          ...page.conversations.filter((c) => !known.has(c.id)),
        ],
        nextCursor: page.nextCursor,
      }
    })
  }, [chatApi, state.nextCursor])

  /** Adds or replaces a conversation (e.g. just opened) and re-sorts. */
  const upsert = useCallback((conversation) => {
    setState((s) => ({
      ...s,
      conversations: sortConversations([
        conversation,
        ...s.conversations.filter((c) => c.id !== conversation.id),
      ]),
    }))
  }, [])

  /** Moves a conversation up after a message was sent in it. */
  const recordMessage = useCallback((message) => {
    setState((s) => ({
      ...s,
      conversations: sortConversations(
        s.conversations.map((c) =>
          c.id === message.conversationId
            ? {
                ...c,
                lastMessageAt: message.createdAt,
                lastMessage: lastMessageFrom(message),
              }
            : c,
        ),
      ),
    }))
  }, [])

  useRealtimeEvent('conversation:update', ({ conversation }) => {
    if (conversation?.id) upsert(conversation)
  })

  // After a reconnect: refetch quietly (keep showing the current list).
  const sync = useCallback(() => setAttempt((n) => n + 1), [])
  useRealtimeEvent('resync', sync)

  return { ...state, reload, loadMore, upsert, recordMessage }
}
