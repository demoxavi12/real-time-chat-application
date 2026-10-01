/**
 * `authorize()` policy for every `/conversations/:conversationId/...` route.
 * Loads the conversation for the *authenticated* user (req.auth) and the
 * validated route id, then exposes it as `req.conversation` for the
 * controller. A missing or inaccessible conversation throws 404
 * CONVERSATION_NOT_FOUND (indistinguishable on purpose).
 */
export function conversationAccess(conversationService) {
  return async (req) => {
    req.conversation = await conversationService.getAccessible(
      req.validated.params.conversationId,
      req.auth.userId,
    )
    return true
  }
}
