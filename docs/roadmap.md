# Roadmap

## Phase 1: Foundation + Core Chat (Day 1 AM)

**Goal:** Two authenticated users can exchange messages in a public room in real time, see each other's presence status, and the plumbing is solid enough that all later features inherit it.

### Deliverables

- Serilog configured; SignalR connection ID enriched on every log entry
- Idempotency key strategy defined: client generates a UUID per send; server deduplicates on insert (race-safe, see `docs/contracts.md`); SignalR reconnect retries without creating duplicates
- Auth endpoints: register, login (by email), logout, persistent session via ASP.NET Identity cookie (not JWT)
- `ChatHub` (SignalR): connect/disconnect lifecycle, join/leave room groups, broadcast message to room
- Public room CRUD: create, list (catalog with search), join, leave (owner cannot leave)
- Real-time messaging in public rooms: send (≤ 3 KB UTF-8), receive, store, display in chronological order
- Presence: online / offline only in Phase 1 (AFK reserved for Phase 2); multi-tab coordination via per-user connection ref-count in the hub; sub-2s propagation via SignalR
- Unread indicator foundation (per-room unread count, cleared on open)
- Tests: auth logic, message deduplication (including race-safe concurrent-same-key path), content-size validation (3 KB boundary), room membership rules (including owner-cannot-leave), pagination correctness, SignalR hub integration, multi-tab presence

**Gate:** See `docs/features/phase-1-spec.md` Scorecard. Authoritative version of the gate — the integration scenario requires **two browser profiles** (or one normal + one incognito window); two tabs in the same profile share the session cookie and cannot hold two user sessions.

---

## Phase 2: Full Feature Set (Day 1 PM → Day 2 AM)

**Goal:** Every core requirement from the brief is implemented and working end-to-end.

### Deliverables

- Private rooms: create, invite-only join, invitation flow
- Room management UI: owner/admin roles, ban/unban, manage admins, room settings, delete room. Implemented as a modal dialog with tabs per Appendix A: **Members / Admins / Banned users / Invitations / Settings**. Banned-users tab shows who banned each user and when — requires `room_bans.banned_by_user_id` + `banned_at` columns (brief 2.4.7)
- Contacts/friends: send friend request (by username or from room member list, with optional text), confirm/reject, remove friend
- User-to-user ban: blocks contact + personal messaging; existing history frozen (read-only)
- Personal messaging (one-to-one dialogs): same feature set as room chat; enforces friendship + no-ban rule
- Message features: reply/quote, edit (with "edited" indicator), delete (by author or room admin)
- Infinite scroll: cursor-based pagination for message history; usable with 10 000+ messages
- File & image sharing: upload via button and paste, optional comment, filename preserved, local filesystem storage, access-controlled download endpoint (members only)
- Active session management: list sessions with browser/IP (populated from `sessions.user_agent` / `sessions.ip_address` captured at login in Phase 1), log out individual sessions
- Password reset and password change flows
- Account deletion with cascade rules (own rooms + their messages/files deleted; memberships in others removed)
- Unread indicators: per room and per personal dialog, cleared on open
- AFK presence state: brief 2.2.2 — user is AFK after ≥ 60 s of no activity across any tab; back to `online` on any heartbeat. Broadcast via existing `PresenceChanged` (`status: 'afk'` reserved in Phase 1)
- UI layout per Appendix A: top nav `ChatLogo | Public Rooms | Private Rooms | Contacts | Sessions | Profile | Sign out`; right-hand sidebar holds rooms + contacts (accordion-compacts when a room is open); members list with presence icons on the far right inside an open room
- Login form: "Keep me signed in" checkbox — unchecked issues a session cookie (cleared on browser close), checked issues a persistent cookie (Phase 1 default). Register form: "Confirm password" field validated client-side
- Tests: friend request rules, ban rules, file access control, message edit/delete permissions, pagination, session invalidation, AFK transition after 60 s

**Gate:** Full user journey works — register, join rooms (public + private), chat with friends, share a file, moderate a room, manage sessions.

---

## Phase 3: Real-Time + Demo-Ready + Minimal XMPP (Day 2 PM)

**Goal:** Close the visible Phase 2 real-time gaps, resolve the private-room catalog leak, and ship a polished demo against a written script. Budget permitting, add a minimal Jabber/XMPP presence via an embedded ejabberd server. Re-scoped from the original Phase 3 brief at 15h remaining budget; see `docs/features/phase-3-spec.md` for priority tags and fallback ladder.

### Deliverables

- Shared app-level SignalR hub connection — fixes known-bugs.md Bug 4 (user-scoped events now flow regardless of page).
- Real-time catalog updates — new `public-rooms-catalog` group; `RoomCreated` broadcast; `RoomDeleted` fanout extended to the catalog.
- Real-time DM sidebar — `DmThreadCreated` broadcast to both participants on first-time thread creation.
- Private-room-catalog leak fix (known-bugs.md Bug 1).
- UI polish pass along the demo path.
- Written demo script (`docs/demo-script.md`) rehearsed end-to-end in under 6 minutes.
- **(P2, shipped — option d)** Minimal XMPP via embedded ejabberd + one-way bridge. ejabberd runs in docker-compose on port 5222. A .NET `BackgroundService` (`XmppBridgeService`) connects as `bridge-bot@chat.local`, joins `bridge@conference.chat.local` MUC, and forwards incoming groupchat messages into the app's `general` room. Messages from XMPP users carry a "via Jabber" badge in the UI. Gajim accounts: `gajim-user-a` / `gajim-user-b` @ `chat.local:5222`, password `Test123!`.

### Explicitly cut from the original Phase 3 brief

- **Server-to-server XMPP federation** (any form). The brief's §6 federation load test (50+/50+, ≥60 s bidirectional) is not in scope.
- **Admin dashboard.** Cut alongside federation — the dashboard's purpose per the original brief was Jabber connection list + federation traffic stats; without federation, it has no unique content.
- **Phase 3 automated tests** for the new surface. Existing Phase 1 + Phase 2 test suites continue to run; Phase 3 relies on the demo script as the manual safety net.

**Gate:** See `docs/features/phase-3-spec.md` Scorecard. Demo walks end-to-end across two browser profiles in ≤ 6 minutes without a live surprise, and the existing Phase 1 + Phase 2 test suites continue to pass.
