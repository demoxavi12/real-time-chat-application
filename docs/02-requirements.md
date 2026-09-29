# Functional & Technical Requirements

## Functional requirements

| ID    | Requirement                          | Priority |
| ----- | ------------------------------------ | -------- |
| FR-01 | User registration                    | P0       |
| FR-02 | User login                           | P0       |
| FR-03 | Authentication/session validation    | P0       |
| FR-04 | Public room access                   | P0       |
| FR-05 | Private conversation creation/access | P0       |
| FR-06 | Send persistent messages             | P0       |
| FR-07 | Receive messages in real time        | P0       |
| FR-08 | Message history pagination           | P0       |
| FR-09 | Online/offline presence              | P1       |
| FR-10 | Typing indicators                    | P1       |
| FR-11 | Read/delivery state                  | P1       |
| FR-12 | Reconnection handling                | P0       |
| FR-13 | API validation                       | P0       |
| FR-14 | Authorization enforcement            | P0       |
| FR-15 | Rate limiting                        | P1       |

## Technical requirements

- React frontend.
- Node.js + Express backend.
- MongoDB with Mongoose or an explicitly documented ODM/data-access layer.
- Socket.IO for real-time transport.
- JWT for authentication.
- REST APIs organized around controllers/services/repositories as appropriate.
- Environment-based configuration.
- Centralized validation.
- Centralized error handling.
- Automated tests in frontend and backend.
- CI pipeline must fail on lint/test/build failures.

## Data consistency requirements

1. A persisted message gets a server-generated ID.
2. Message timestamps are server-generated.
3. Authorization is checked server-side for every protected resource.
4. Socket events must not bypass REST-layer business rules conceptually; shared service functions should own core business logic where practical.
5. Clients must tolerate duplicate/reordered transient events.
6. MongoDB indexes required for common message/conversation queries.

## Error categories

- 400 validation
- 401 authentication
- 403 authorization
- 404 resource not found
- 409 conflict
- 429 rate limit
- 500 unexpected server error
- Socket authentication error
- Socket authorization error
- Socket validation error
- Connection/retry failure
