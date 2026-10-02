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

**Implemented (Phase 2)** — `apps/server/src/models/conversation.model.js`,
collection `conversations`:

| Field                    | Type           | Notes                                                               |
| ------------------------ | -------------- | ------------------------------------------------------------------- |
| `type`                   | String         | `public` \| `private`                                               |
| `name`                   | String\|null   | `General` for the public room; `null` for private conversations     |
| `participantIds`         | ObjectId[]     | Private: exactly two different users. Public: empty (open to all)   |
| `privateKey`             | String         | Private only: the two participant ids sorted and joined (`a:b`)     |
| `createdBy`              | ObjectId\|null | Who first opened the private conversation                           |
| `lastMessageAt`          | Date\|null     | Time of the latest message                                          |
| `lastActivityAt`         | Date           | Sort key for lists: creation, then each message (moved with `$max`) |
| `lastMessage`            | Object         | null                                                                | Denormalized latest-message summary for lists (see below) |
| `createdAt`, `updatedAt` | Date           | timestamps                                                          |

- `lastMessage` is `{ messageId, senderId, preview, createdAt }` (`preview`:
  one line, at most 120 characters, ending in `…` when truncated). It is
  written in the same conditional update as `lastMessageAt`
  (`lastMessageAt` null or ≤ the new message's time), so a slower,
  older write can never overwrite a newer preview. It is a cache of the
  `messages` collection, which stays the source of truth (ADR-034).
- The schema enforces the shape (exactly two distinct participants and a
  matching `privateKey` for private; no participants for public) and is
  `strict: 'throw'`.
- Indexes:
  - `private_pair_unique`: `{ privateKey: 1 }` unique, partial on
    `type: "private"` — the **database** guarantees one conversation per
    pair; the open-or-create code relies on it (duplicate-key → read the
    winner), not on a check-then-insert.
  - `public_room_singleton`: `{ type: 1 }` unique, partial on
    `type: "public"` — one public room; created idempotently at startup.
  - `participant_activity`: `{ participantIds: 1, lastActivityAt: -1, _id: -1 }`
    — "my conversations, most recent first" with keyset pagination.
- Membership is the `participantIds` array (plus the implicit
  everyone-membership of the public room); there is no separate membership
  collection and no membership-changing API (none is specified).

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

**Implemented (Phase 2)** — `apps/server/src/models/message.model.js`,
collection `messages`:

| Field             | Type       | Notes                                                                                                           |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `conversationId`  | ObjectId   | Authorized conversation                                                                                         |
| `senderId`        | ObjectId   | Always the authenticated user                                                                                   |
| `clientMessageId` | String?    | Optional idempotency key from the client                                                                        |
| `content`         | String     | Plain text, 1–2000 characters (validated + trimmed)                                                             |
| `readBy`          | ObjectId[] | Read state: the sender on creation; `message:read` adds readers (`$addToSet`) in **private** conversations only |
| `createdAt`       | Date       | Server time only (no `updatedAt`: messages are immutable)                                                       |

- Indexes:
  - `conversation_history`: `{ conversationId: 1, createdAt: -1, _id: -1 }` —
    history pages and the keyset cursor (`_id` breaks timestamp ties).
    Verified by an `explain()` test (IXSCAN, no COLLSCAN).
  - `client_message_id_unique`: `{ conversationId: 1, senderId: 1, clientMessageId: 1 }`
    unique, partial on `clientMessageId` being a string — retry dedup.
  - No `{ senderId, createdAt }` index: no query needs it yet.
- Reads are recorded only in private conversations (at most two entries);
  in the public room `readBy` would grow with every reader, so public reads
  are not stored (ADR-030). `readBy` itself is never exposed; the message
  shape carries a derived `seen` flag instead (private: read by someone other
  than the sender; public: `null`).

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
