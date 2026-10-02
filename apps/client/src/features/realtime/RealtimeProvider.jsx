import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../services/api/httpClient.js'
import { useAuth } from '../auth/authContext.js'
import { RealtimeContext } from './realtimeContext.js'

// Server -> client events from docs/06-websocket-protocol.md.
const SERVER_EVENTS = [
  'message:new',
  'conversation:update',
  'typing:update',
  'message:read:update',
  'presence:update',
]
const AUTH_ERRORS = new Set([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_INVALID',
])
const ACK_TIMEOUT_MS = 10_000

/**
 * Joins a room with an acknowledgement and then emits a local `joined`
 * signal: views refetch the latest page so nothing stored between their REST
 * fetch and the completed join can be missed.
 */
function joinRoom(socket, conversationId, dispatch) {
  socket
    .timeout(ACK_TIMEOUT_MS)
    .emitWithAck('conversation:join', { conversationId })
    .then(
      (reply) => reply?.success && dispatch('joined', conversationId),
      () => {},
    )
}

/**
 * Owns the Socket.IO connection for the signed-in user.
 *
 * - Connects only while authenticated; disconnects on logout/unmount.
 * - Registers exactly ONE socket listener per server event and fans events
 *   out to subscribers (`subscribe`), so React re-renders/remounts never
 *   accumulate listeners.
 * - Reference-counts conversation rooms; after every reconnect it rejoins
 *   them and emits a local `resync` so views refetch durable state over
 *   REST (socket delivery is not a history mechanism).
 * - A server-side disconnect (logout/expiry) or an auth handshake error
 *   makes the auth state re-check the session.
 */
export function RealtimeProvider({ createSocket, children }) {
  const { status: authStatus, user, retry: recheckSession } = useAuth()
  const userId = authStatus === 'authenticated' ? user.id : null
  // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'; reported
  // as 'idle' while signed out.
  const [status, setStatus] = useState('connecting')
  const [online, setOnline] = useState(() => new Set())
  const socketRef = useRef(null)
  const subscribers = useRef(new Map())
  const rooms = useRef(new Map())

  const dispatch = useCallback((event, payload) => {
    for (const handler of subscribers.current.get(event) ?? []) handler(payload)
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    const socket = createSocket()
    socketRef.current = socket
    let connectedBefore = false

    const loadPresence = () =>
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('presence:list')
        .then(
          (reply) => reply?.success && setOnline(new Set(reply.data.online)),
          () => {},
        )

    for (const event of SERVER_EVENTS) {
      socket.on(event, (payload) => dispatch(event, payload))
    }
    socket.on('presence:update', ({ userId: id, status: presence }) => {
      setOnline((current) => {
        const next = new Set(current)
        if (presence === 'online') next.add(id)
        else next.delete(id)
        return next
      })
    })
    socket.on('connect', () => {
      setStatus('connected')
      for (const conversationId of rooms.current.keys()) {
        joinRoom(socket, conversationId, dispatch)
      }
      loadPresence()
      if (connectedBefore) dispatch('resync')
      connectedBefore = true
    })
    socket.on('disconnect', (reason) => {
      setStatus('disconnected')
      // Server-initiated: the session was revoked or expired.
      if (reason === 'io server disconnect') recheckSession()
    })
    socket.on('connect_error', (error) => {
      setStatus('disconnected')
      if (AUTH_ERRORS.has(error?.data?.code ?? error?.message)) recheckSession()
    })
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'))

    socket.connect()
    return () => {
      socket.removeAllListeners()
      socket.io.off('reconnect_attempt')
      socket.disconnect()
      socketRef.current = null
      setStatus('connecting')
      setOnline(new Set())
    }
  }, [userId, createSocket, dispatch, recheckSession])

  const subscribe = useCallback((event, handler) => {
    const set = subscribers.current.get(event) ?? new Set()
    set.add(handler)
    subscribers.current.set(event, set)
    return () => set.delete(handler)
  }, [])

  /** Joins a conversation room; returns the matching leave function. */
  const joinConversation = useCallback(
    (conversationId) => {
      const count = rooms.current.get(conversationId) ?? 0
      rooms.current.set(conversationId, count + 1)
      if (count === 0 && socketRef.current?.connected) {
        joinRoom(socketRef.current, conversationId, dispatch)
      }
      return () => {
        const remaining = (rooms.current.get(conversationId) ?? 1) - 1
        if (remaining > 0) {
          rooms.current.set(conversationId, remaining)
          return
        }
        rooms.current.delete(conversationId)
        if (socketRef.current?.connected) {
          socketRef.current.emit('conversation:leave', { conversationId })
        }
      }
    },
    [dispatch],
  )

  /**
   * Sends over the socket and resolves with the canonical stored message
   * from the acknowledgement. Rejects with ApiError (NOT_CONNECTED, a server
   * code, or ACK_TIMEOUT when the ack was lost — retrying with the same
   * clientMessageId is then safe).
   */
  const sendMessage = useCallback(async (payload) => {
    const socket = socketRef.current
    if (!socket?.connected) {
      throw new ApiError({
        status: 0,
        code: 'NOT_CONNECTED',
        message: 'Not connected',
      })
    }
    let reply
    try {
      reply = await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('message:send', payload)
    } catch {
      throw new ApiError({
        status: 0,
        code: 'ACK_TIMEOUT',
        message: 'No acknowledgement',
      })
    }
    if (!reply?.success) {
      throw new ApiError({
        status: 0,
        code: reply?.error?.code ?? 'UNKNOWN',
        message: reply?.error?.message ?? 'Message was not sent',
        details: reply?.error?.details ?? [],
      })
    }
    return reply.data.message
  }, [])

  const emitIfConnected = useCallback((event, payload) => {
    if (socketRef.current?.connected) socketRef.current.emit(event, payload)
  }, [])
  // Actions are stable callbacks: consumers may use them in effect deps
  // without re-running effects whenever presence or connection state changes.
  const startTyping = useCallback(
    (conversationId) => emitIfConnected('typing:start', { conversationId }),
    [emitIfConnected],
  )
  const stopTyping = useCallback(
    (conversationId) => emitIfConnected('typing:stop', { conversationId }),
    [emitIfConnected],
  )
  const markRead = useCallback(
    (conversationId, messageId) =>
      emitIfConnected('message:read', { conversationId, messageId }),
    [emitIfConnected],
  )

  const value = useMemo(
    () => ({
      status: userId ? status : 'idle',
      connected: Boolean(userId) && status === 'connected',
      subscribe,
      joinConversation,
      sendMessage,
      startTyping,
      stopTyping,
      markRead,
      isOnline: (id) => online.has(id),
    }),
    [
      userId,
      status,
      online,
      subscribe,
      joinConversation,
      sendMessage,
      startTyping,
      stopTyping,
      markRead,
    ],
  )

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}
