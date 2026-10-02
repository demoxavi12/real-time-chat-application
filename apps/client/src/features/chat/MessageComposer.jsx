import { useEffect, useRef, useState } from 'react'
import { useRealtime } from '../realtime/realtimeContext.js'
import {
  describeChatError,
  MESSAGE_MAX_LENGTH,
  newClientMessageId,
  validateMessage,
} from './chatModel.js'

const TYPING_IDLE_MS = 3000

/**
 * Sends a message over Socket.IO (message:send + acknowledgement), or over
 * REST while the socket is not connected; both paths are durable and share
 * server-side deduplication. The draft is kept if sending fails, and a retry
 * of the same draft reuses its clientMessageId so the server can never store
 * it twice (e.g. when the acknowledgement was lost).
 */
export function MessageComposer({ chatApi, conversationId, onSent }) {
  const realtime = useRealtime()
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const pending = useRef(null)
  const typing = useRef({ active: false, timer: null })

  const { startTyping, stopTyping } = realtime
  const stopTypingNow = () => {
    clearTimeout(typing.current.timer)
    if (typing.current.active) stopTyping(conversationId)
    typing.current.active = false
  }

  // Stop typing only when the composer unmounts or switches conversation.
  // (Reading stopTyping through a ref keeps unrelated context updates, such
  // as presence changes, from triggering a spurious typing:stop.)
  const stopTypingRef = useRef(stopTyping)
  useEffect(() => {
    stopTypingRef.current = stopTyping
  })
  useEffect(() => {
    const state = typing.current
    return () => {
      clearTimeout(state.timer)
      if (state.active) stopTypingRef.current(conversationId)
      state.active = false
    }
  }, [conversationId])

  function handleChange(event) {
    const value = event.target.value
    setContent(value)
    if (!value.trim()) {
      stopTypingNow()
      return
    }
    if (!typing.current.active) {
      typing.current.active = true
      startTyping(conversationId)
    }
    clearTimeout(typing.current.timer)
    typing.current.timer = setTimeout(stopTypingNow, TYPING_IDLE_MS)
  }

  async function send() {
    if (sending) return
    const { text, error: invalid } = validateMessage(content)
    if (invalid) {
      setError(invalid)
      return
    }
    if (pending.current?.text !== text) {
      pending.current = { text, clientMessageId: newClientMessageId() }
    }
    const payload = {
      content: text,
      clientMessageId: pending.current.clientMessageId,
    }
    setSending(true)
    setError(null)
    stopTypingNow()
    try {
      const message = realtime.connected
        ? await realtime.sendMessage({ conversationId, ...payload })
        : await chatApi.sendMessage(conversationId, payload)
      pending.current = null
      setContent('')
      onSent(message)
    } catch (sendError) {
      setError(
        sendError?.code === 'ACK_TIMEOUT'
          ? 'No confirmation from the server yet. Send again to retry safely.'
          : describeChatError(sendError),
      )
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(event) {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <label htmlFor="message-input">Message</label>
      <textarea
        id="message-input"
        rows={2}
        value={content}
        maxLength={MESSAGE_MAX_LENGTH}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'message-error' : undefined}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {error && (
        <p id="message-error" role="alert" className="field-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={sending}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
