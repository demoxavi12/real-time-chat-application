# Real-Time Chat Application — Project Charter

## 1. Project

**Name:** Real-Time Chat Application\
**Stack:** React, Node.js, Express.js, MongoDB, Socket.IO, JWT\
**Primary goal:** Build a production-quality real-time messaging platform that supports authenticated users, public chat, private 1-to-1 conversations, presence, typing indicators, message history, and reliable WebSocket communication.

## 2. Resume target

The finished project should honestly support claims such as:

- Developed a scalable real-time messaging platform supporting concurrent multi-user communication using WebSockets.
- Implemented secure JWT-based authentication with private and public chat functionality.
- Built a React + Socket.IO client with bidirectional client-server communication.
- Designed modular REST APIs following MVC principles.
- Added automated tests, validation, security controls, and CI quality gates.

## 3. Product principles

1. Correctness before visual polish.
2. Server is authoritative for authentication, authorization, persistence, and message state.
3. REST handles durable resources and account operations.
4. Socket.IO handles real-time events.
5. Every important behavior must have an automated test.
6. Claude must not declare a phase complete without running the relevant checks.
7. No manual verification should be required for routine development.
8. Secrets, credentials, debug logging, and hard-coded production hosts must never enter source control.

## 4. MVP scope

### Included

- Registration and login
- JWT authentication
- User profile/basic account data
- Public chat room
- Private 1-to-1 conversations
- Message persistence
- Paginated message history
- Real-time message delivery
- Online/offline presence
- Typing indicators
- Read/delivery state
- Reconnection handling
- Input validation
- Rate limiting
- Centralized error handling
- Automated unit/integration/API/WebSocket tests
- Linting, formatting, build verification, and CI

### Explicitly out of MVP

- Voice/video calls
- End-to-end encryption
- File/image uploads
- Push notifications
- Message reactions
- Message editing/deletion history
- Full-text search
- Multi-device conflict resolution
- Microservices

These can be future milestones, not hidden MVP requirements.

## 5. Definition of success

The project is complete only when:

- Backend tests pass.
- Frontend tests pass.
- WebSocket integration tests pass.
- Lint passes.
- Production builds pass.
- Security checks pass.
- API contract tests pass.
- Database indexes are validated.
- Critical user flows are covered by automated browser tests.
- README and setup documentation are accurate.
- No known P0/P1 defects remain.
