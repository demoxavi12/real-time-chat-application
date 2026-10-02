import { conversationRoom, sessionRoom, userRoom } from './rooms.js'

/**
 * Server-side real-time notifications, shared by the Socket.IO handlers and
 * the REST controllers so both send paths behave identically. Every method
 * is called only AFTER the durable operation succeeded, and none of them
 * throws: a notification problem must never fail (or roll back) a message
 * that is already stored in MongoDB. Clients recover anything they missed
 * through REST history.
 *
 * Audience rules:
 * - message:new           -> sockets that joined conversation:<id>
 *                            (joining is authorized), except the sender's
 *                            socket, which gets the acknowledgement instead
 * - conversation:update   -> private: the participants' user:<id> rooms;
 *                            public room: every authenticated socket
 * - session revocation    -> disconnects the session:<sid> room
 */
export function createRealtimeHub({ conversationService, logger }) {
  let io = null

  async function emitConversationUpdate(conversation, overrides = {}) {
    const [presented] = await conversationService.present([conversation])
    const payload = { conversation: { ...presented, ...overrides } }
    if (conversation.type === 'public') {
      io.emit('conversation:update', payload)
    } else {
      io.to(conversation.participantIds.map(userRoom)).emit(
        'conversation:update',
        payload,
      )
    }
  }

  return {
    attach(server) {
      io = server
    },

    async messageCreated({ conversation, message, exceptSocketId }) {
      if (!io) return
      try {
        const room = io.to(conversationRoom(conversation._id))
        ;(exceptSocketId ? room.except(exceptSocketId) : room).emit(
          'message:new',
          { message },
        )
        await emitConversationUpdate(conversation, {
          lastMessageAt: message.createdAt,
        })
      } catch (error) {
        logger.error('realtime message notification failed', {
          conversationId: String(conversation._id),
          err: error,
        })
      }
    },

    async conversationCreated(conversation) {
      if (!io) return
      try {
        await emitConversationUpdate(conversation)
      } catch (error) {
        logger.error('realtime conversation notification failed', {
          conversationId: String(conversation._id),
          err: error,
        })
      }
    },

    /** Logout: every socket opened with that session is disconnected. */
    sessionRevoked(sessionId) {
      if (!io || !sessionId) return
      io.in(sessionRoom(sessionId)).disconnectSockets(true)
    },
  }
}
