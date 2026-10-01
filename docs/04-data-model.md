# Data Model

## User

```text
_id
name
email
passwordHash
avatarUrl?
lastSeenAt
createdAt
updatedAt
```

Constraints:

- Unique normalized email.
- Password is never stored in plaintext.
- Never return passwordHash from normal API responses.

**Implemented (Phase 1)** — `apps/server/src/models/user.model.js`, collection
`users`:

| Field                    | Type         | Notes                                                      |
| ------------------------ | ------------ | ---------------------------------------------------------- |
| `_id`                    | ObjectId     | Server-generated; exposed as `id`                          |
| `name`                   | String       | Required, trimmed, ≤ 50                                    |
| `email`                  | String       | Required, trimmed + lower-cased by the model setter, ≤ 254 |
| `passwordHash`           | String       | Argon2id PHC string; `select: false`                       |
| `lastSeenAt`             | Date \| null | Set on registration and login (presence updates it later)  |
| `createdAt`, `updatedAt` | Date         | Mongoose timestamps                                        |

- `avatarUrl` is not implemented (not needed yet).
- Indexes: `email_unique` (`{ email: 1 }`, unique). Created explicitly at
  startup (`ensureIndexes`), not via background autoIndex; concurrent
  duplicate registrations produce exactly one user (tested).
- Schema is `strict: 'throw'`: unknown fields are an error, not silently
  dropped.
- Public representation (`toPublicUser`): `{ id, name, email, createdAt }`
  only.

## RevokedSession (implemented — Phase 1)

Server-side logout denylist, collection `revokedsessions`:

```text
_id
sessionId   (the JWT `sid` claim)
expiresAt   (end of the session's absolute lifetime)
createdAt
```

Indexes: `sessionId_unique` (unique) and `expiresAt_ttl`
(`expireAfterSeconds: 0`), so MongoDB deletes entries once the session could
no longer be valid anyway. Queries are by `sessionId` only.

## Conversation

```text
_id
type: "public" | "private"
name?
participantIds[]
createdBy?
createdAt
updatedAt
lastMessageAt?
```

Rules:

- Public room can be represented as a singleton/system conversation.
- Private conversations must contain exactly two participants.
- A private conversation must not be duplicated for the same pair.

Recommended index:

- type
- participantIds
- updatedAt / lastMessageAt as appropriate

## Message

```text
_id
conversationId
senderId
clientMessageId?
content
createdAt
readBy[]
```

Rules:

- senderId comes from authenticated server identity.
- conversationId must be authorized.
- content length is bounded.
- createdAt is server-generated.
- clientMessageId can support retry deduplication.

Recommended indexes:

- { conversationId: 1, createdAt: -1 }
- { conversationId: 1, _id: -1 } if pagination strategy needs it
- { senderId: 1, createdAt: -1 } only if a real query requires it

## Presence

Presence is ephemeral and should not be treated as authoritative durable data.

Suggested runtime state:

```text
userId -> connectionCount / socketIds / lastSeenAt
```

If multiple backend instances are introduced, move shared ephemeral state to Redis or another shared system.

## Pagination

Prefer cursor-based pagination for messages.

Example:

```text
GET /api/conversations/:conversationId/messages?limit=30&before=<cursor>
```

Do not use unbounded `skip()` pagination for a production-style message timeline.
