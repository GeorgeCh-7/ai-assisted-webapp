# Product

## Mission

Build a fully-featured classic web chat that satisfies the hackathon brief — rooms, contacts, real-time presence, file sharing, moderation, and Jabber federation — as a working, demo-ready application for a single developer in two days.

## Users

Authenticated users in a chat community. Primary audience for the demo is the hackathon judges evaluating functional completeness against the brief.

## Scope

### In

- **Auth:** registration (email + unique username), login, persistent session, password reset/change, account deletion, active session list with per-session logout
- **Presence:** online / AFK / offline states; multi-tab coordination; sub-2s propagation
- **Public rooms:** discoverable catalog with search, free join, room metadata (name, description, member count)
- **Private rooms:** invite-only, not listed in catalog
- **Room management:** create, leave, delete; owner/admin roles; ban/unban members; manage admins; room settings
- **Real-time messaging:** SignalR hub; plain text, multiline, emoji, reply/quote; edit; delete (by author or room admin); chronological order; infinite scroll for history
- **Contacts/friends:** friend requests (by username or from room member list), confirmation flow, remove friend, user-to-user ban with frozen history
- **Personal messaging:** one-to-one dialogs, same feature set as room messages; only available between mutual friends with no active ban
- **File & image sharing:** upload via button or paste; original filename preserved; optional comment; served only to current room members / chat participants; 20 MB file / 3 MB image limits; local filesystem storage
- **Unread indicators:** per room and per contact, cleared on open
- **Idempotency & retries:** idempotency keys on all message sends; frontend retry via TanStack Query mutations and SignalR reconnect logic; no duplicate messages on reconnect
- **Structured logging:** Serilog with SignalR connection ID enriched on every log entry
- **Testing:** business logic unit tests + API endpoint integration tests written alongside each phase
- **Jabber/XMPP:** client connectivity via a .NET XMPP library; server-to-server federation via docker-compose two-server setup; admin dashboard with connection stats and federation traffic

### Out

- Automated CI/CD
- Production Dockerfiles / secrets management
- Email verification
- Forced periodic password change
- Rate limiting, metrics, distributed tracing
- Mobile / native clients
