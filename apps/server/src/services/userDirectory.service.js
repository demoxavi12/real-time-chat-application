import { toPage, userCursor } from './pagination.js'

/** Public directory entry: deliberately only id and display name. */
export function toDirectoryUser(user) {
  return { id: String(user._id), name: user.name }
}

export function createUserDirectoryService({ users }) {
  return {
    /** Other users, optionally filtered by `q`, keyset-paginated by id. */
    async search(requesterId, { q, limit, cursor }) {
      const after = cursor ? userCursor.decode(cursor) : undefined
      const rows = await users.search({
        excludeId: requesterId,
        q,
        afterId: after?.id,
        limit: limit + 1,
      })
      const { items, nextCursor } = toPage(rows, limit, userCursor.encode)
      return { users: items.map(toDirectoryUser), nextCursor }
    },
  }
}
