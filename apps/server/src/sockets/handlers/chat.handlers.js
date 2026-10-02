import { parseWithSchema } from '../../validators/parseWithSchema.js'
import {
  conversationEventSchema,
  readMessageSchema,
  socketSendMessageSchema,
} from '../../validators/socket.validators.js'
import { conversationRoom } from '../rooms.js'

/**
 * Chat events (docs/06-websocket-protocol.md). Identity is always
 * `socket.data.auth.userId` from the authenticated handshake; conversation
 * access uses the same rule and services as REST.
 */
export function createChatHandlers({
  conversationService,
  messageService,
  realtime,
  presence,
  users,
  logger,
}) {
  return function registerChatHandlers({ io, socket, on }) {
    const { userId } = socket.data.auth
    const typingIn = new Set()

    // A joined room was authorized at join time (fast path). Otherwise check
    // access now: Socket.IO runs handlers concurrently, so an event sent
    // right after conversation:join may arrive before the join completed.
    const requireAccess = async (conversationId) => {
      if (socket.rooms.has(conversationRoom(conversationId))) return
      await conversationService.getAccessible(conversationId, userId)
    }

    const stopTyping = (conversationId) => {
      if (!typingIn.delete(conversationId)) return
      socket
        .to(conversationRoom(conversationId))
        .emit('typing:update', { conversationId, userId, typing: false })
    }

    // ---- presence ----------------------------------------------------
    if (presence.connect(userId)) {
      logger.debug('presence online', { userId })
      socket.broadcast.emit('presence:update', { userId, status: 'online' })
    }
    socket.on('disconnect', () => {
      for (const conversationId of [...typingIn]) stopTyping(conversationId)
      if (presence.disconnect(userId)) {
        logger.debug('presence offline', { userId })
        io.emit('presence:update', { userId, status: 'offline' })
        users.touchLastSeen(userId).catch((error) => {
          logger.error('failed to record lastSeenAt', { err: error })
        })
      }
    })

    on('presence:list', () => ({ online: presence.onlineUserIds() }))

    // ---- rooms -------------------------------------------------------
    on('conversation:join', async (payload) => {
      const { conversationId } = parseWithSchema(
        conversationEventSchema,
        payload,
      )
      await conversationService.getAccessible(conversationId, userId)
      await socket.join(conversationRoom(conversationId)) // idempotent
      return { conversationId }
    })

    on('conversation:leave', async (payload) => {
      const { conversationId } = parseWithSchema(
        conversationEventSchema,
        payload,
      )
      stopTyping(conversationId)
      await socket.leave(conversationRoom(conversationId))
      return { conversationId }
    })

    // ---- messages ----------------------------------------------------
    on(
      'message:send',
      async (payload) => {
        const { conversationId, clientMessageId, content } = parseWithSchema(
          socketSendMessageSchema,
          payload,
        )
        const conversation = await conversationService.getAccessible(
          conversationId,
          userId,
        )
        // Durable first: nothing is announced unless this succeeds.
        const { message, created } = await messageService.send({
          conversation,
          senderId: userId,
          content,
          clientMessageId,
        })
        stopTyping(conversationId)
        if (created) {
          await realtime.messageCreated({
            conversation,
            message,
            exceptSocketId: socket.id,
          })
        }
        return {
          clientMessageId,
          messageId: message.id,
          createdAt: message.createdAt,
          duplicate: !created,
          message,
        }
      },
      // Without an ack callback the result is emitted as `message:ack`.
      { limit: 'message', ackEvent: 'message:ack' },
    )

    on('message:read', async (payload) => {
      const { conversationId, messageId } = parseWithSchema(
        readMessageSchema,
        payload,
      )
      const conversation = await conversationService.getAccessible(
        conversationId,
        userId,
      )
      const { recorded, changed } = await messageService.markRead({
        conversation,
        messageId,
        userId,
      })
      if (changed) {
        io.to(conversationRoom(conversationId)).emit('message:read:update', {
          conversationId,
          messageId,
          userId,
        })
      }
      return { recorded }
    })

    // ---- typing (ephemeral, never stored) -----------------------------
    on('typing:start', async (payload) => {
      const { conversationId } = parseWithSchema(
        conversationEventSchema,
        payload,
      )
      await requireAccess(conversationId)
      if (!typingIn.has(conversationId)) {
        typingIn.add(conversationId)
        socket
          .to(conversationRoom(conversationId))
          .emit('typing:update', { conversationId, userId, typing: true })
      }
      return { conversationId }
    })

    on('typing:stop', async (payload) => {
      const { conversationId } = parseWithSchema(
        conversationEventSchema,
        payload,
      )
      await requireAccess(conversationId)
      stopTyping(conversationId)
      return { conversationId }
    })
  }
}
