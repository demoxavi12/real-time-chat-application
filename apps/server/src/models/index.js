import { getConversationModel } from './conversation.model.js'
import { getMessageModel } from './message.model.js'
import { getRevokedSessionModel } from './revokedSession.model.js'
import { getUserModel } from './user.model.js'

/** Registers every model on `connection`. */
export function registerModels(connection) {
  return {
    User: getUserModel(connection),
    RevokedSession: getRevokedSessionModel(connection),
    Conversation: getConversationModel(connection),
    Message: getMessageModel(connection),
  }
}

/**
 * Creates the declared indexes (unique email, TTL, private-pair uniqueness,
 * message history...) before the server accepts traffic. Uniqueness is a
 * correctness guarantee, so it is not left to Mongoose's background autoIndex.
 */
export async function ensureIndexes(models) {
  await Promise.all(Object.values(models).map((model) => model.createIndexes()))
}
