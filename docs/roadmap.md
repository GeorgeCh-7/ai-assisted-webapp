# Roadmap

## Phase 1: Foundation + Core Chat (Day 1 AM)

**Goal:** Two authenticated users can exchange messages in a public room in real time, see each other's presence status, and the plumbing is solid enough that all later features inherit it.

### Deliverables

- Serilog configured; SignalR connection ID enriched on every log entry
- Idempotency key strategy defined: client generates a UUID per send; server deduplicates on insert; SignalR reconnect retries without creating duplicates
- Auth endpoints: register, login, logout, persistent session (cookie or JWT)
- `ChatHub` (SignalR): connect/disconnect lifecycle, join/leave room groups, broadcast message to room
- Public room CRUD: create, list (catalog with search), join, leave
- Real-time messaging in public rooms: send, receive, store, display in chronological order
- Presence: online/AFK/offline; multi-tab heartbeat; sub-2s propagation via SignalR
- Unread indicator foundation (per-room unread count, cleared on open)
- Tests: auth logic, message deduplication, room membership rules, SignalR hub integration

**Gate:** Two browser tabs log in as different users, join the same public room, exchange messages, and see each other's presence update in under 2 seconds.

---

## Phase 2: Full Feature Set (Day 1 PM → Day 2 AM)

**Goal:** Every core requirement from the brief is implemented and working end-to-end.

### Deliverables

- Private rooms: create, invite-only join, invitation flow
- Room management UI: owner/admin roles, ban/unban, manage admins, room settings, delete room
- Contacts/friends: send friend request (by username or from room member list, with optional text), confirm/reject, remove friend
- User-to-user ban: blocks contact + personal messaging; existing history frozen (read-only)
- Personal messaging (one-to-one dialogs): same feature set as room chat; enforces friendship + no-ban rule
- Message features: reply/quote, edit (with "edited" indicator), delete (by author or room admin)
- Infinite scroll: cursor-based pagination for message history; usable with 10 000+ messages
- File & image sharing: upload via button and paste, optional comment, filename preserved, local filesystem storage, access-controlled download endpoint (members only)
- Active session management: list sessions with browser/IP, log out individual sessions
- Password reset and password change flows
- Account deletion with cascade rules (own rooms + their messages/files deleted; memberships in others removed)
- Unread indicators: per room and per personal dialog, cleared on open
- Tests: friend request rules, ban rules, file access control, message edit/delete permissions, pagination, session invalidation

**Gate:** Full user journey works — register, join rooms (public + private), chat with friends, share a file, moderate a room, manage sessions.

---

## Phase 3: Jabber + Polish (Day 2 PM)

**Goal:** Jabber/XMPP client connectivity and server federation working; application is demo-ready.

### Deliverables

- Jabber/XMPP integration via a .NET XMPP library: users can connect using a Jabber client
- Server federation: docker-compose setup with two server instances exchanging messages
- Admin dashboard: Jabber connection list, federation traffic stats
- UI polish: visual review against wireframes, edge-case handling, console.log cleanup
- Demo script: step-by-step walkthrough covering all major features
- Tests: Jabber connection lifecycle, federation message delivery

**Gate:** A Jabber client connects to the server, exchanges a message with a user on a second federated server instance; admin dashboard shows the traffic.
