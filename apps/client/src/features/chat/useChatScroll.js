import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const NEAR_BOTTOM_PX = 80

/**
 * Scroll behaviour for a message log:
 * - first render and my own new messages: jump to the newest message;
 * - new messages while I am near the bottom: follow them;
 * - new messages while I read older ones: keep my position and offer a
 *   "new messages" button instead of yanking the view;
 * - older history prepended: keep the same messages in view.
 */
export function useChatScroll(messages, currentUserId) {
  const containerRef = useRef(null)
  const previous = useRef({ firstId: null, lastId: null, height: 0 })
  const nearBottom = useRef(true)
  const [hasUnseenNew, setHasUnseenNew] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
    nearBottom.current = true
    setHasUnseenNew(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    nearBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (nearBottom.current) setHasUnseenNew(false)
  }, [])

  useLayoutEffect(() => {
    const el = containerRef.current
    const before = previous.current
    const first = messages[0]?.id ?? null
    const last = messages.at(-1)
    previous.current = {
      firstId: first,
      lastId: last?.id ?? null,
      height: el?.scrollHeight ?? 0,
    }
    if (!el || !last) return

    if (before.lastId === null) {
      el.scrollTop = el.scrollHeight
      return
    }
    if (last.id !== before.lastId) {
      if (nearBottom.current || last.sender.id === currentUserId) {
        el.scrollTop = el.scrollHeight
      } else {
        setHasUnseenNew(true)
      }
      return
    }
    if (first !== before.firstId) {
      // Older messages were prepended above: keep the visible ones in place.
      el.scrollTop += el.scrollHeight - before.height
    }
  }, [messages, currentUserId])

  return { containerRef, onScroll, hasUnseenNew, scrollToBottom }
}
