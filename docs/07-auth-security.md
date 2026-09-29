# Authentication & Security Design

## Authentication

Use JWT-based authentication.

Preferred browser strategy:

- Short-lived access token.
- Secure, HttpOnly, SameSite cookie where compatible with the deployment architecture.
- Do not place long-lived secrets in localStorage by default.
- If a different strategy is selected, document the threat model and reason.

## Passwords

- Hash using a modern password hashing algorithm such as Argon2id or bcrypt with an appropriate cost.
- Never log passwords.
- Never return password hashes.
- Enforce password length requirements.
- Consider generic login failure messages to reduce account enumeration.

## Authorization

Every protected operation must answer:

1. Who is the authenticated user?
2. What resource is being accessed?
3. Is this user allowed to access it?

Private conversation authorization is mandatory for both REST and Socket.IO.

## Input security

- Validate body/query/path/socket payloads.
- Bound message size.
- Sanitize/escape output as appropriate to prevent XSS.
- Never execute user-provided HTML/scripts.
- Reject malformed ObjectIds/IDs before database calls.

## HTTP security

Use appropriate middleware for:

- Helmet/security headers.
- CORS with explicit allowed origins.
- Rate limiting.
- Request size limits.
- Safe JSON parsing.

## Socket security

- Authenticate during handshake.
- Apply per-event validation.
- Rate-limit high-frequency events.
- Avoid accepting arbitrary room joins.
- Never let a client choose an identity.

## Database security

- Use environment variables for credentials.
- Least-privilege database user.
- Validate schemas.
- Add indexes deliberately.
- Avoid returning unrestricted documents.

## Secrets

Never commit:

```text
.env
.env.local
JWT secrets
MongoDB credentials
API keys
private keys
test credentials
```

Provide `.env.example` with placeholders only.

## Logging

Logs may contain:

- request ID
- route
- status
- latency
- event name
- non-sensitive user identifier where justified

Logs must not contain:

- passwords
- JWTs
- cookies
- authorization headers
- database credentials
- full private message bodies by default

## Security testing

Automate checks for:

- unauthorized REST access
- unauthorized private conversation access
- invalid socket token
- forged sender identity
- malformed payloads
- oversized messages
- rate-limit behavior
- XSS payload handling
- CORS configuration
