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

### Real-time layer (Phase 3)

- `RealtimeProvider` (inside `AuthProvider`) owns one Socket.IO connection
  while signed in; it registers exactly one socket listener per server
  event and fans events out to subscribers (`useRealtimeEvent`), so
  re-renders and remounts never accumulate listeners (tested).
- Provider actions (`joinConversation`, `sendMessage`, `startTyping`, `stopTyping`,
  `markRead`) are stable callbacks, so effects that depend on them do not re-run
  when presence or connection state changes (a regression test covers a
  previous bug where any presence change sent a spurious `typing:stop`).
- Conversation views join their room on mount and leave on unmount
  (reference-counted). After every reconnect the provider rejoins rooms and
  emits a local `resync`; lists and history refetch over REST.
- A server-side disconnect (logout elsewhere/session end) or an auth
  handshake error re-checks the session, which routes to the login page.
- Sending: `message:send` with an acknowledgement when connected, REST when
  not; the draft is kept on failure and retries reuse the same
  `clientMessageId`. No optimistic placeholder messages (correctness first):
  the canonical message from the ack/REST response is rendered.
- Incoming `message:new`, acks, REST pages and post-reconnect refetches are
  merged by message id and ordered by (createdAt, id): duplicates and
  out-of-order events never duplicate or misplace messages.
- `conversation:update` upserts and re-sorts the conversation list.
- Typing: the composer sends `typing:start` once per burst and
  `typing:stop` after 3 s idle, on clearing or on send; "<name> is typing…"
  expires after 6 s without updates.
- Read receipts (private conversations): the newest incoming message is
  reported once via `message:read`; "Seen" appears under my latest message
  when the other participant has read it (live, during the session).
- Presence: initial `presence:list` + `presence:update`; "Online"/"Offline"
  in the conversation header and "(online)" in the list.
- Connection indicator in the account bar: Live / Connecting… /
  Reconnecting… / Offline.

### Production UX (Phase 4)

- **Conversation list:** each entry shows kind, title, "(online)" with a
  presence dot (text, not colour only), a compact activity time ("now",
  "5m", "3h", date) and a one-line preview ("You: …", "Bob: …", "No messages
  yet") from the server's `lastMessage`; the preview updates live from
  `conversation:update` and locally after my own sends. Links are named by
  the title only; kind and preview are the accessible description. The
  loading message shows only while the list is empty (refreshes keep the
  list visible). Items are memoized.
- **Messages:** mine ("You", right-aligned) vs. theirs; consecutive messages
  from the same sender within five minutes on the same day are grouped
  (sender visually hidden but still announced); day dividers ("Today",
  "Yesterday", date); time per group. My latest message shows **Sent** or
  **Seen** — "Seen" comes from the server's `seen` flag (so it survives a
  reload) or a live `message:read:update`; the public room only ever shows
  "Sent".
- **Scrolling (`useChatScroll`):** opens at the newest message; follows new
  messages while near the bottom and always after my own sends; while I read
  history a "New messages ↓" button appears instead of jumping; loading
  older messages keeps the visible messages in place.
- **History container:** `role="log"` with polite live announcements of
  additions, keyboard-focusable and scrollable.
- **Sending:** a synchronous in-flight guard means a double Enter/click sends
  once (the server's `clientMessageId` dedup is the second line of defence).
- **Session expiry:** any `401` from a data request (`handleAuthError`)
  re-checks the session; if a previously signed-in session is gone the login
  page says "Your session has ended. Please sign in again." (not shown after
  an explicit sign-out or to first-time visitors).
- **Focus:** opening a conversation moves focus to its heading
  (`tabIndex=-1`); visible focus rings throughout.
- **Responsive:** at ≤ 48rem the list and the conversation are separate
  views (`.conversation-open` on the layout); the conversation has a "Back to
  conversations" link; the history height uses `dvh` and the composer is
  sticky so it stays reachable with the on-screen keyboard; long words wrap
  (`overflow-wrap: anywhere`), so there is no horizontal scrolling down to
  320px. Large screens show both panes side by side. Touch targets are at
  least 44px on small screens.
- **Reduced motion:** `prefers-reduced-motion: reduce` disables transitions,
  animations and smooth scrolling.
- Verified by `tests/chatUx.test.jsx` (Vitest) and `e2e/ux.spec.js`
  (Playwright, including 320px and 1920px viewports and the Pixel 7 project).
