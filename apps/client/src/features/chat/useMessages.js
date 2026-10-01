import { useCallback, useEffect, useState } from 'react'
import { mergeMessages } from './chatModel.js'

const PAGE_SIZE = 30
const NOT_FOUND_CODES = new Set(['CONVERSATION_NOT_FOUND', 'VALIDATION_ERROR'])

/**
 * One conversation and its history. Mount it with `key={conversationId}` so
 * switching conversations starts from a clean state.
 */
export function useMessages(chatApi, conversationId) {
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
          // Keep anything already shown (refresh merges the latest page).
          messages: mergeMessages(s.messages, page.messages),
          nextCursor: s.messages.length ? s.nextCursor : page.nextCursor,
          error: null,
        })),
      (error) => {
        if (error?.name === 'AbortError') return
        setState((s) => ({
          ...s,
          status: NOT_FOUND_CODES.has(error?.code) ? 'notFound' : 'error',
          error,
        }))
      },
    )
    return () => controller.abort()
  }, [chatApi, conversationId, attempt])

  /** Re-fetches the latest page (no live updates until Phase 3). */
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])

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

  const addMessage = useCallback((message) => {
    setState((s) => ({ ...s, messages: mergeMessages(s.messages, [message]) }))
  }, [])

  return { ...state, refresh, loadOlder, addMessage }
}
