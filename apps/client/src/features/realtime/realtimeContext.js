import { createContext, useContext, useEffect, useRef } from 'react'

export const RealtimeContext = createContext(null)

/** Access the Socket.IO connection state and actions (see RealtimeProvider). */
export function useRealtime() {
  const value = useContext(RealtimeContext)
  if (!value)
    throw new Error('useRealtime must be used inside <RealtimeProvider>')
  return value
}

/**
 * Subscribes `handler` to a server event for the component's lifetime.
 * The subscription is created once per event name; the latest handler is
 * read through a ref, so re-renders never add listeners.
 */
export function useRealtimeEvent(event, handler) {
  const { subscribe } = useRealtime()
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(
    () => subscribe(event, (payload) => latest.current(payload)),
    [subscribe, event],
  )
}
