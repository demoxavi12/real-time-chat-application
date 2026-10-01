function withQuery(path, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

const segment = (id) => encodeURIComponent(id)

/**
 * Conversations, messages and the user directory (durable REST operations).
 * Real-time delivery arrives with Socket.IO in Phase 3.
 */
export function createChatApi(http) {
  return {
    listConversations: ({ limit, cursor } = {}, options) =>
      http.get(withQuery('/conversations', { limit, cursor }), options),

    openPrivateConversation: (userId) =>
      http
        .request('/conversations/private', { method: 'POST', body: { userId } })
        .then((data) => data.conversation),

    getConversation: (conversationId, options) =>
      http
        .get(`/conversations/${segment(conversationId)}`, options)
        .then((data) => data.conversation),

    listMessages: (conversationId, { limit, before } = {}, options) =>
      http.get(
        withQuery(`/conversations/${segment(conversationId)}/messages`, {
          limit,
          before,
        }),
        options,
      ),

    sendMessage: (conversationId, { content, clientMessageId }) =>
      http
        .request(`/conversations/${segment(conversationId)}/messages`, {
          method: 'POST',
          body: { content, clientMessageId },
        })
        .then((data) => data.message),

    searchUsers: ({ q, limit, cursor } = {}, options) =>
      http.get(withQuery('/users', { q, limit, cursor }), options),
  }
}
