# Frontend Specification

## Main screens

1. Login
2. Register
3. Chat shell
4. Conversation list
5. Public chat
6. Private chat
7. Profile/account menu
8. Connection/error state

## Chat shell

```text
App
 ├─ Sidebar
 │   ├─ Current user
 │   ├─ Public room
 │   └─ Private conversations
 └─ Main chat
     ├─ Header
     ├─ Message list
     ├─ Typing indicator
     └─ Composer
```

## State categories

### Server state

- Current user
- Conversations
- Message history
- User search

### Real-time state

- Socket connection status
- Presence
- Typing users
- Incoming messages

### Local UI state

- Selected conversation
- Draft message
- Modal state
- Loading/error states

Do not create a giant global state object unless there is a demonstrated need.

## Socket lifecycle

- Connect after authentication is established.
- Register listeners once.
- Clean up listeners on unmount/logout.
- Reconnect automatically.
- Resynchronize durable state after reconnect.
- Do not assume the client received every event while disconnected.

## Message sending

Preferred flow:

1. Generate clientMessageId.
2. Render pending message if optimistic UI is used.
3. Emit message.
4. Server validates and persists.
5. Server sends acknowledgement.
6. Replace pending state with durable message.
7. Broadcast durable message to recipients.
8. Reconcile duplicates by clientMessageId/messageId.

## Accessibility

- Keyboard navigation.
- Visible focus.
- Semantic buttons/inputs.
- Accessible labels.
- Message list usable with screen readers.
- Do not rely only on color for state.

## Responsive behavior

Desktop and mobile layouts must both be tested using automated browser tests.

## Implementation status (Phase 2)

Implemented (REST only — no live updates until Phase 3):

```text
App (AuthProvider, routes)
 ├─ /login, /register            (Phase 1)
 ├─ /status                       (public system status)
 └─ / (RequireAuth) HomePage
     ├─ Account bar (current user, System status link, Sign out)
     ├─ Sidebar
     │   ├─ ConversationList     public room + private conversations, Refresh, "More"
     │   └─ UserSearch           name prefix / exact email -> "Message <name>"
     └─ <Outlet>
         ├─ index: "Select a conversation…"
         └─ conversations/:id: ConversationView
             ├─ Header (other participant's name / "General") + Refresh
             ├─ "Load older messages" (cursor)
             ├─ Message list (oldest -> newest, text only)
             └─ MessageComposer (REST send)
```

- State: `useConversations` (list, load more, upsert, move-to-top on send) and
  `useMessages` (conversation + history, load older, refresh, add). The
  conversation view is keyed by id so switching conversations resets it.
- Composer: Enter sends, Shift+Enter adds a newline; trimmed 1–2000
  characters validated client-side; button disabled while sending; on
  failure the draft is kept and a retry reuses the same `clientMessageId`
  so the server never stores it twice.
- Loading, empty ("No conversations yet", "No messages yet"), error (with
  retry) and not-found (inaccessible conversation) states are all rendered.
- Message content is rendered as React text (escaped, `white-space: pre-wrap`),
  never as HTML.
- Not implemented yet: typing indicator, presence, read state, live updates,
  reconnection UI.
