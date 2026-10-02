import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext.js'
import { useRealtime, useRealtimeEvent } from '../realtime/realtimeContext.js'
import { mergeMessages } from './chatModel.js'

const PAGE_SIZE = 30
const NOT_FOUND_CODES = new Set(['CONVERSATION_NOT_FOUND', 'VALIDATION_ERROR'])

/**
 * One conversation: durable history from REST, then live updates from
 * Socket.IO. Mount it with `key={conversationId}` so switching conversations
 * starts from a clean state.
 *
 * Every source (REST page, ack, message:new, refetch after reconnect) is
 * merged by message id and re-sorted by (createdAt, id), so duplicate or
 * out-of-order events can never produce duplicate or misplaced messages.
 */
export function useMessages(chatApi, conversationId) {
  const { joinConversation } = useRealtime()
  const { handleAuthError } = useAuth()
  const [state, setState] = useState({
    status: 'loading',
    conversation: null,
    messages: [],
    nextCursor: null,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    Promise.all([
      chatApi.getConversation(conversationId, options),
      chatApi.listMessages(conversationId, { limit: PAGE_SIZE }, options),
    ]).then(
      ([conversation, page]) =>
        setState((s) => ({
          status: 'ready',
          conversation,
          messages: mergeMessages(s.messages, page.messages),
          nextCursor: s.messages.length ? s.nextCursor : page.nextCursor,
          error: null,
        })),
      (error) => {
        if (error?.name === 'AbortError' || handleAuthError(error)) return
        setState((s) => ({
          ...s,
          status: NOT_FOUND_CODES.has(error?.code) ? 'notFound' : 'error',
          error,
        }))
      },
    )
    return () => controller.abort()
  }, [chatApi, conversationId, attempt, handleAuthError])

  // Live delivery for this conversation while the view is mounted.
  useEffect(
    () => joinConversation(conversationId),
    [joinConversation, conversationId],
  )

  const addMessage = useCallback((message) => {
    setState((s) => ({ ...s, messages: mergeMessages(s.messages, [message]) }))
  }, [])

  useRealtimeEvent('message:new', ({ message }) => {
    if (message?.conversationId === conversationId) addMessage(message)
  })

  /** Re-fetches the latest page and merges it (also after reconnects). */
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  useRealtimeEvent('resync', refresh)
  // Close the gap between the initial REST fetch and the completed join.
  useRealtimeEvent('joined', (joinedId) => {
    if (joinedId === conversationId) refresh()
  })

  const loadOlder = useCallback(async () => {
    const page = await chatApi.listMessages(conversationId, {
      limit: PAGE_SIZE,
      before: state.nextCursor,
    })
    setState((s) => ({
      ...s,
      messages: mergeMessages(s.messages, page.messages),
      nextCursor: page.nextCursor,
    }))
  }, [chatApi, conversationId, state.nextCursor])

  return { ...state, refresh, loadOlder, addMessage }
}
