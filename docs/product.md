# Product

## Mission

Build a fully-featured classic web chat that satisfies the hackathon brief — rooms, contacts, real-time presence, file sharing, moderation, and Jabber federation — as a working, demo-ready application for a single developer in two days.

## Users

Authenticated users in a chat community. Primary audience for the demo is the hackathon judges evaluating functional completeness against the brief.

## Scope

### In

- **Auth:** registration (email + unique username; **username is immutable after registration** per brief 2.1.2 — the denormalized `authorUsername` on historical messages depends on this invariant, so no username-change endpoint exists at any phase), login by email + password, persistent session, password reset/change, account deletion, active session list with browser/IP + per-session logout
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

## Non-functional targets

From brief §3:

- **Concurrent users:** up to 300 simultaneously connected (informs SignalR connection-handling design, not a hard limit to stress-test)
- **Per-room participants:** up to 1 000 (informs per-room broadcast cost — one `MessageReceived` broadcast goes to up to 1 000 connections)
- **Rooms per user:** unlimited; typical sizing ~20 rooms, ~50 contacts
- **Message delivery latency:** ≤ 3 s from send to recipient-visible
- **Presence propagation:** ≤ 2 s for online ↔ offline transitions (tighter than the 3 s message bound)
- **History scale:** rooms remain usable with ≥ 10 000 messages — drives the watermark index and cursor-pagination design
- **Persistence:** messages persist indefinitely ("for years")
- **File storage:** local filesystem; 20 MB file cap, 3 MB image cap
- **Layout (brief §4 + Appendix A):** classic web-chat layout — top nav, center message area, bottom composer, **right-hand sidebar** with rooms + contacts (accordion-compacts when a room is open), members panel with presence icons on the far right inside an open room. The product should read as a "classic web chat," not a modern social/collaboration app
