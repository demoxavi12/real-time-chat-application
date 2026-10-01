import { useRef, useState } from 'react'
import {
  describeChatError,
  MESSAGE_MAX_LENGTH,
  newClientMessageId,
  validateMessage,
} from './chatModel.js'

/**
 * Sends a message over REST. The draft is kept if sending fails, and a retry
 * of the same draft reuses its clientMessageId so the server cannot store it
 * twice (e.g. when the first response was lost).
 */
export function MessageComposer({ chatApi, conversationId, onSent }) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const pending = useRef(null)

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
    setSending(true)
    setError(null)
    try {
      const message = await chatApi.sendMessage(conversationId, {
        content: text,
        clientMessageId: pending.current.clientMessageId,
      })
      pending.current = null
      setContent('')
      onSent(message)
    } catch (sendError) {
      setError(describeChatError(sendError))
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
        onChange={(event) => setContent(event.target.value)}
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
