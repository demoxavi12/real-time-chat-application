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
