import request from 'supertest'
import { registerUser } from './auth.js'

/** A registered user plus convenience methods that send their session. */
export async function signedInUser(baseUrl, overrides) {
  const account = await registerUser(baseUrl, overrides)
  const as = (method, path) =>
    request(baseUrl)[method](path).set('Cookie', account.cookie)
  return {
    ...account,
    id: account.user.id,
    get: (path) => as('get', path),
    post: (path) => as('post', path),
    async openPrivateWith(other) {
      const res = await as('post', '/api/conversations/private').send({
        userId: other.id,
      })
      if (![200, 201].includes(res.status)) {
        throw new Error(`open private failed: ${res.status} ${res.text}`)
      }
      return res.body.data.conversation
    },
    async send(conversationId, content, extra = {}) {
      const res = await as(
        'post',
        `/api/conversations/${conversationId}/messages`,
      ).send({
        content,
        ...extra,
      })
      if (![200, 201].includes(res.status)) {
        throw new Error(`send failed: ${res.status} ${res.text}`)
      }
      return res.body.data.message
    },
  }
}

/** The public room id as seen by `user`. */
export async function publicRoomId(user) {
  const res = await user.get('/api/conversations')
  return res.body.data.conversations.find((c) => c.type === 'public').id
}
