import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtime, useRealtimeEvent } from '../realtime/realtimeContext.js'

// typing:update is ephemeral: a "typing" state that is not refreshed or
// stopped within this time is dropped (covers lost stop events).
export const TYPING_EXPIRY_MS = 6000

/** Users currently typing in `conversationId` (excluding me). */
export function useTypingUsers(conversationId, currentUserId) {
  const [typing, setTyping] = useState(() => new Set())
  const timers = useRef(new Map())

  const drop = useCallback((userId) => {
    clearTimeout(timers.current.get(userId))
    timers.current.delete(userId)
    setTyping((current) => {
      if (!current.has(userId)) return current
      const next = new Set(current)
      next.delete(userId)
      return next
    })
  }, [])

  useRealtimeEvent('typing:update', (update) => {
    if (
      update.conversationId !== conversationId ||
      update.userId === currentUserId
    )
      return
    if (!update.typing) {
      drop(update.userId)
      return
    }
    clearTimeout(timers.current.get(update.userId))
    timers.current.set(
      update.userId,
      setTimeout(() => drop(update.userId), TYPING_EXPIRY_MS),
    )
    setTyping((current) => new Set(current).add(update.userId))
  })

  // A message from someone ends their typing state.
  useRealtimeEvent('message:new', ({ message }) => {
    if (message?.conversationId === conversationId) drop(message.sender.id)
  })

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return typing
}

/**
 * Read state for a private conversation: reports the newest message from
 * the other participant as read (once per message) and tracks which of my
 * messages the other participant has read during this session.
 */
export function useReadReceipts({ conversation, messages, currentUserId }) {
  const { markRead, connected } = useRealtime()
  const reported = useRef(new Set())
  const [readByOthers, setReadByOthers] = useState(() => new Set())
  const isPrivate = conversation?.type === 'private'

  const latestFromOthers = [...messages]
    .reverse()
    .find((message) => message.sender.id !== currentUserId)

  useEffect(() => {
    if (!isPrivate || !connected || !latestFromOthers) return
    if (reported.current.has(latestFromOthers.id)) return
    reported.current.add(latestFromOthers.id)
    markRead(conversation.id, latestFromOthers.id)
  }, [isPrivate, connected, latestFromOthers, markRead, conversation?.id])

  useRealtimeEvent('message:read:update', (update) => {
    if (
      !isPrivate ||
      update.conversationId !== conversation.id ||
      update.userId === currentUserId
    ) {
      return
    }
    setReadByOthers((current) => new Set(current).add(update.messageId))
  })

  /** True if the other participant read `message` or anything after it. */
  return useCallback(
    (message) => {
      const index = messages.findIndex((m) => m.id === message.id)
      return messages.some((m, i) => i >= index && readByOthers.has(m.id))
    },
    [messages, readByOthers],
  )
}
