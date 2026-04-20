# API Contracts — Phase 1

> **Status: LOCKED — Phase 1 implementation complete.**
> All changes after lock require explicit agreement from both tracks.
> Track B mocks against this doc (MSW handlers). Track A implements against it.
> Drift on this document is the primary Phase 1 failure mode.

---

## Auth Contract

### Session Cookie
| Field | Value |
|-------|-------|
| Name | `.chat.session` |
| HttpOnly | `true` |
| SameSite | `Lax` |
| Secure | `false` in dev |
| Path | `/` |

### CSRF
| Field | Value |
|-------|-------|
| Seed cookie name | `XSRF-TOKEN` — JS-readable, **not** HttpOnly |
| Request header | `X-XSRF-TOKEN` |
| Configured via | `AddAntiforgery(opts => opts.HeaderName = "X-XSRF-TOKEN")` |
| Seeded by | `GET /api/auth/me` — backend calls `IAntiforgery.GetAndStoreTokens(ctx)` |
| Required on | Every POST / PUT / PATCH / DELETE |

**Request-token vs cookie-token — read this carefully.** `IAntiforgery.GetAndStoreTokens(ctx)` returns an `AntiforgeryTokenSet` with two distinct fields: `.CookieToken` and `.RequestToken`. The framework automatically writes `.CookieToken` to its own HttpOnly cookie (`.AspNetCore.Antiforgery.*`). The `XSRF-TOKEN` cookie we set manually in `/api/auth/me` must contain **`tokens.RequestToken`**, not a copy of the framework cookie and not `tokens.CookieToken`. The frontend reads `XSRF-TOKEN` and echoes it as `X-XSRF-TOKEN`, which the antiforgery middleware validates against the framework-managed cookie-token. Using the cookie-token value in `XSRF-TOKEN` produces a 400 `Bad Request` on every mutation with a cryptic `AntiforgeryValidationException`. This bug surfaced at the Phase 1 integration gate — the field-name clarification is recorded here so Phase 2+ agents do not repeat it.

Frontend rule: the shared fetch wrapper must read `XSRF-TOKEN` from `document.cookie` and echo it as `X-XSRF-TOKEN` on every mutating request.

### CORS (dev)
`WithOrigins("http://localhost:5173").AllowCredentials()` — must be a specific origin (not `*`) when cookies are involved.
Fetch wrapper: `credentials: 'include'` on every request.

### /api/auth/me — Bootstrap Call
Call this immediately after login and on every app load. It seeds the CSRF cookie.
**Return 401 as JSON — never redirect. The frontend handles routing.**

---

## Error Envelope

**REST** uses a single human-readable field — no machine codes:
```json
{ "error": "Human-readable message" }
```
**SignalR hub** errors use a different shape with machine codes, dispatched via `Clients.Caller.SendAsync("Error", …)` (never thrown):
```ts
{ code: string, message: string }
```
REST and hub error shapes are intentionally distinct — do not unify them. Frontend `lib/api.ts` parses `{ error }`; the SignalR client subscribes to `"Error"` and reads `{ code, message }`.

---

## Pagination

**Messages** (backward scroll, newest-first):
```
GET /api/rooms/{id}/messages?before={watermark}&limit=50
```
`watermark` is the integer watermark of the oldest message currently displayed. Omit → return most recent 50. Results are DESC by watermark.

**Message gap recovery** (ascending from a known watermark):
```
GET /api/rooms/{id}/messages?since={watermark}&limit=50
```
Returns messages with `watermark > since`, ASC order. Used by SignalR reconnect logic to fill gaps after a disconnect. `before` and `since` are mutually exclusive.

**Rooms catalog** (forward scroll):
```
GET /api/rooms?q={search}&cursor={cursor}&limit=20
```
Omit `cursor` → first page. Cursor is **opaque** to the client (encoded server-side). Implement as keyset pagination over `(name ASC, id ASC)` — base64-encode the last row's `(name, id)` tuple as the `nextCursor`. Do **not** use `OFFSET/LIMIT` — breaks under concurrent room inserts and degrades linearly with offset.

Response wrapper (all):
```json
{
  "items": [...],
  "nextCursor": "string | null"
}
```
`nextCursor: null` means no more pages.

---

## REST Endpoints

### POST /api/auth/register
Auth: none. CSRF: none.

Request:
```json
{ "username": "string", "email": "string", "password": "string" }
```
Password rules: minimum 6 characters, no other complexity requirements (matches `opts.Password.RequireNonAlphanumeric = false` + Identity's default `RequiredLength = 6`). Username is immutable after creation — no update endpoint exists at any phase.

Response 200:
```json
{ "id": "uuid", "username": "string", "email": "string" }
```
Errors: `400 { "error": "Username already taken" }` · `400 { "error": "Email already registered" }` · `400 { "error": "Password must be at least 6 characters" }`

---

### POST /api/auth/login
Auth: none. CSRF: none.
Sets `.chat.session` cookie on success.

Request:
```json
{ "email": "string", "password": "string" }
```
Login is by **email + password** per brief 2.1.3 and the login wireframe. Usernames are for display/addressing (friend requests, @-mentions, message author), not for authentication.

Response 200:
```json
{ "id": "uuid", "username": "string", "email": "string" }
```
Error: `401 { "error": "Invalid credentials" }` — returned for both unknown email and wrong password (don't leak which).

After login: call `GET /api/auth/me` before any mutations.

---

### POST /api/auth/logout
Auth: required. CSRF: required.
Clears `.chat.session` cookie. Marks session revoked in `sessions` table.

Response 200: `{}`

---

### GET /api/auth/me
Auth: required. **Always seeds `XSRF-TOKEN` cookie.**

Response 200:
```json
{ "id": "uuid", "username": "string", "email": "string" }
```
Response 401: `{ "error": "Unauthenticated" }`

---

### GET /api/rooms
Auth: required.
Query: `q` (search, optional) · `cursor` (optional) · `limit` (default 20, max 50)

Response 200:
```json
{
  "items": [
    { "id": "uuid", "name": "string", "description": "string", "memberCount": 0, "isMember": false, "isPrivate": false, "myRole": null }
  ],
  "nextCursor": "string | null"
}
```
Phase 1 always returns `isPrivate: false` (no private rooms yet) and filters the catalog accordingly. `myRole` is `null` when `isMember: false`; when `isMember: true`, it's `'owner'` for the creator and `'member'` otherwise. `'admin'` is reserved for Phase 2.

---

### POST /api/rooms
Auth: required. CSRF: required.
Creator is automatically joined as the **owner** — a `room_memberships` row is inserted with `role='owner'`, and `rooms.created_by_id` references the creator. The response therefore returns `myRole: "owner"`.

Request:
```json
{ "name": "string", "description": "string" }
```
Response 201:
```json
{ "id": "uuid", "name": "string", "description": "string", "memberCount": 1, "isMember": true, "isPrivate": false, "myRole": "owner" }
```
Errors: `400 { "error": "Name is required" }` · `409 { "error": "Room name already taken" }`

---

### GET /api/rooms/{id}
Auth: required.

Response 200:
```json
{ "id": "uuid", "name": "string", "description": "string", "memberCount": 0, "isMember": false, "isPrivate": false, "myRole": null }
```
Response 404: `{ "error": "Room not found" }`

---

### POST /api/rooms/{id}/join
Auth: required. CSRF: required.

Response 200:
```json
{ "id": "uuid", "name": "string", "description": "string", "memberCount": 1, "isMember": true, "isPrivate": false, "myRole": "member" }
```
Errors: `404 { "error": "Room not found" }` · `409 { "error": "Already a member" }`

---

### POST /api/rooms/{id}/leave
Auth: required. CSRF: required.
Owners cannot leave their own room — they must delete it (Phase 2). Enforced server-side.

Response 200: `{}`

Errors: `404 { "error": "Room not found" }` · `400 { "error": "Not a member" }` · `403 { "error": "Owner cannot leave their own room" }`

---

### GET /api/rooms/{id}/messages
Auth: required. Caller must be a room member.
Query: `before` (watermark integer, optional) · `since` (watermark integer, optional; mutually exclusive with `before`) · `limit` (default 50, max 50)
Order: `before` → DESC by watermark (newest-first, for normal scroll). `since` → ASC by watermark (oldest-first, for gap recovery).

Response 200:
```json
{
  "items": [
    {
      "id": "uuid",
      "roomId": "uuid",
      "authorId": "uuid",
      "authorUsername": "string",
      "content": "string",
      "sentAt": "2024-01-01T12:00:00Z",
      "idempotencyKey": "uuid",
      "watermark": 42,
      "editedAt": null,
      "deletedAt": null,
      "replyToMessageId": null
    }
  ],
  "nextCursor": "string | null"
}
```
`id` and `idempotencyKey` are the same value. `watermark` is the room-scoped monotonic integer assigned at insert. `editedAt` / `deletedAt` / `replyToMessageId` are reserved for Phase 2 and always null in Phase 1 — shape matches `MessageReceived` exactly.

Errors: `403 { "error": "Not a member" }` · `404 { "error": "Room not found" }`

---

## SignalR — ChatHub

**URL:** `/hubs/chat`
**Hub auth:** `[Authorize]` on hub class. Cookie populates `Context.User` on WS handshake — no separate token handshake needed.
**Group naming:** `room-{roomId}` (prefix avoids future collision with DM groups).

### Client → Server

#### JoinRoom
```ts
{ roomId: string }
```
Adds caller to `room-{roomId}`. Hub validates DB membership — if no `room_memberships` row exists for `(userId, roomId)`, rejects with `Error { code: "NOT_MEMBER" }`. Hub does **not** create memberships — clients must first call `POST /api/rooms/{id}/join` over REST to create the membership, **then** invoke `JoinRoom` on the hub to subscribe to live events. Two-step subscription is intentional: membership is durable state (REST), subscription is a per-connection transient (hub).
On success broadcasts `UserJoinedRoom` to the group.
**Returns to caller (invoke return value):** `{ currentWatermark: number }` — the room's latest watermark at join time. Client stores this and compares against `lastSeenWatermark` on reconnect to detect gaps.

#### LeaveRoom
```ts
{ roomId: string }
```
Removes caller from `room-{roomId}`. Broadcasts `UserLeftRoom`.

#### SendMessage
```ts
{ roomId: string, content: string, idempotencyKey: string }
```
`idempotencyKey`: client-generated UUID. Same value on every retry of the same logical message.
`content`: UTF-8 text, max **3 KB** (3072 bytes in UTF-8 encoding) per brief 2.5.2. Validate server-side: reject with hub `Error { code: "MESSAGE_TOO_LARGE", message: "Message exceeds 3 KB" }` before insert. Clients should enforce the same limit in the composer for UX, but the server is the source of truth.
Hub dedup: insert with PK = `idempotencyKey`, catch unique violation on concurrent duplicates (see `docs/features/phase-1-spec.md` idempotency flow).
On new message: persists, broadcasts `MessageReceived` to `room-{roomId}`.
**Returns to caller (invoke return value):** the persisted `Message` — same shape as `MessageReceived`. Callers rely on this to reconcile optimistic inserts with server-assigned `watermark` / `sentAt`. On the dedup catch path, returns the already-persisted message so every invoke with the same key resolves identically.

#### Heartbeat
```ts
{}
```
Updates `user_presence.last_heartbeat_at` for the caller. No broadcast; no effect on online/offline state.

**Online/offline driver (Phase 1):** a single process-wide `ConcurrentDictionary<Guid, int>` in the hub counts active connections per user. `OnConnectedAsync` increments; when the count goes 0 → 1, write `user_presence.status = 'online'` and broadcast `PresenceChanged`. `OnDisconnectedAsync` decrements; when the count goes 1 → 0, write `'offline'` and broadcast. **Do not** persist the connection counter — it's transient, and server restart correctly treats everyone as offline until SignalR reconnect repopulates the map. Do not create a `user_connections` table.

**AFK (Phase 2):** brief 2.2.2 defines AFK as ≥ 60 s without activity across all tabs. Phase 2 sweeper transitions users to AFK when `last_heartbeat_at` is older than 60 s, and back to `online` on the next heartbeat. Client should send a heartbeat on any user interaction (mousemove/keypress/focus), debounced to ~15 s.

### Server → Client

#### MessageReceived
To: `room-{roomId}`
```ts
{
  id: string                     // same as idempotencyKey
  roomId: string
  authorId: string
  authorUsername: string
  content: string
  sentAt: string                 // ISO 8601
  idempotencyKey: string
  watermark: number              // room-scoped monotonic integer; client tracks max seen per room
  editedAt: string | null        // reserved for Phase 2; always null in Phase 1
  deletedAt: string | null       // reserved for Phase 2; always null in Phase 1
  replyToMessageId: string | null // reserved for Phase 2; always null in Phase 1
}
```
The three reserved fields ship as `null` in Phase 1. Frontend must render them (treat as absent) without crashing; types must include them. Adding fields to an active event later forces coordinated deploys — reserving them now is free.

#### PresenceChanged
To: all room groups the affected user belongs to
```ts
{ userId: string, status: 'online' | 'afk' | 'offline' }
```
Phase 1 only emits `'online'` and `'offline'`. `'afk'` is reserved for Phase 2 so exhaustive `switch` / discriminated-union consumers don't break when AFK lands.

#### UserJoinedRoom
To: `room-{roomId}`
```ts
{ userId: string, username: string, roomId: string }
```

#### UserLeftRoom
To: `room-{roomId}`
```ts
{ userId: string, roomId: string }
```

### Hub Error Pattern
Hub methods never throw to callers. On rejection, dispatch via `Clients.Caller.SendAsync("Error", new { code, message })` — **not** by throwing; thrown exceptions would close the connection or surface as generic `HubException`. The invoke can return `null`/default after dispatch; the client treats `"Error"` as the authoritative failure signal for the in-flight call.

Shape:
```ts
{ code: string, message: string }
```
Event name: `"Error"`.

Frontend listens for `"Error"` and surfaces inline. Phase 1 codes: `NOT_MEMBER`, `ROOM_NOT_FOUND`, `MESSAGE_TOO_LARGE`.

---

## DB Schema (reference — Track A owns, Track B uses DTO shapes above)

Managed by `EnsureCreated()`. Snake_case via `EFCore.NamingConventions`. Identity tables renamed in `OnModelCreating`.

| Table | Key columns |
|-------|-------------|
| `users` | `id uuid`, `user_name text`, `email text`, `password_hash text` |
| `user_claims` | Identity default, renamed |
| `sessions` | `id uuid PK`, `user_id uuid FK`, `created_at`, `last_seen_at`, `is_revoked bool`, `user_agent text NULL`, `ip_address inet NULL` |
| `rooms` | `id uuid PK`, `name text UNIQUE`, `description text`, `created_at`, `created_by_id uuid FK`, `current_watermark bigint NOT NULL DEFAULT 0`, `is_private bool NOT NULL DEFAULT false` |
| `room_memberships` | `room_id uuid`, `user_id uuid` — composite PK, `joined_at`, `role text NOT NULL DEFAULT 'member'` (`'owner' \| 'admin' \| 'member'`; Phase 1 writes `'owner'` for the creator, `'member'` otherwise; `'admin'` arrives in Phase 2) |
| `messages` | `id uuid PK` (= idempotency key), `room_id uuid FK ON DELETE CASCADE`, `author_id uuid FK NULL ON DELETE SET NULL`, `content text`, `sent_at`, `watermark bigint NOT NULL` |
| `user_presence` | `user_id uuid PK`, `status text CHECK (status IN ('online','afk','offline'))`, `last_heartbeat_at` |
| `room_unreads` | `user_id uuid`, `room_id uuid` — composite PK, `count int`, `last_read_message_id uuid` |

Index: `ix_messages_room_watermark` on `(room_id, watermark DESC)` — required for efficient cursor pagination. Add via `HasIndex` in `OnModelCreating`.

**Cascade rationale:** `messages.author_id` is nullable with `ON DELETE SET NULL` so Phase 2 account deletion doesn't need to fan out into every historical message. The author-mapping layer substitutes a `[deleted user]` placeholder username when `author_id` is null — DTOs keep `authorId` / `authorUsername` non-nullable for Phase 1 consumers. `messages.room_id` cascades on room deletion (Phase 2 room delete nukes its history in one statement). These behaviors must be set on the FK relationships in `OnModelCreating` — EF Core defaults would `Restrict` and break Phase 2 deletion flows.

**Phase 2 columns added now:** `rooms.is_private` and `room_memberships.role` are reserved columns — Phase 1 populates them with defaults (`false` / `'owner'` or `'member'`) but does not expose them in feature logic. Adding these columns in Phase 2 would require nuking the DB volume (since we use `EnsureCreated()`, not migrations). Adding them up-front avoids that.

---

# API Contracts — Phase 2

> **Status: DRAFT — locks when both tracks agree.**
> Additive to Phase 1. Phase 1 section above is LOCKED and unchanged except for the inline CSRF clarification.

---

## Phase 2 DB Schema additions

Managed by `EnsureCreated()`. Schema churn requires one coordinated `docker compose down -v` at the start of Phase 2 Merge 1; after that, only new-table additions (no column changes to existing tables) until the next coordinated reset.

### Modified Phase 1 tables

| Table | Added columns |
|-------|---------------|
| `messages` | `edited_at timestamptz NULL`, `deleted_at timestamptz NULL`, `reply_to_message_id uuid NULL FK → messages.id ON DELETE SET NULL` |
| `sessions` | (none — `user_agent` and `ip_address` were captured in Phase 1 for this) |

### New tables

| Table | Key columns |
|-------|-------------|
| `room_invitations` | `id uuid PK`, `room_id uuid FK ON DELETE CASCADE`, `invitee_user_id uuid FK ON DELETE CASCADE`, `invited_by_user_id uuid FK ON DELETE CASCADE`, `created_at`, `status text CHECK IN ('pending','accepted','declined','revoked')`, `responded_at timestamptz NULL`. Unique `(room_id, invitee_user_id)` where `status = 'pending'` |
| `room_bans` | `room_id uuid`, `banned_user_id uuid` — composite PK, `banned_by_user_id uuid FK`, `banned_at timestamptz`, `reason text NULL`. FKs: `room_id ON DELETE CASCADE`, `banned_user_id ON DELETE CASCADE`, `banned_by_user_id ON DELETE SET NULL` (preserve ban when banner deletes their account) |
| `friendships` | `user_a_id uuid`, `user_b_id uuid` — composite PK, `status text CHECK IN ('pending','accepted')`, `requested_by_user_id uuid FK`, `requested_at`, `accepted_at timestamptz NULL`, `request_message text NULL` (optional text from the requester, max 500 chars enforced at the application layer). **Check constraint: `user_a_id < user_b_id`**. Both FKs `ON DELETE CASCADE` |
| `user_bans` | `banner_user_id uuid`, `banned_user_id uuid` — composite PK, `banned_at timestamptz`. Both FKs `ON DELETE CASCADE`. Asymmetric — two-way ban requires two rows |
| `dm_threads` | `id uuid PK`, `user_a_id uuid`, `user_b_id uuid`, `created_at`, `current_watermark bigint NOT NULL DEFAULT 0`, `frozen_at timestamptz NULL` (set when user_bans exists between a/b, cleared on unban), `other_party_deleted_at timestamptz NULL` (set when either party deletes their account). Unique `(user_a_id, user_b_id)` with check `user_a_id < user_b_id` for lookup canonicalization. FKs: `user_a_id` / `user_b_id` `ON DELETE RESTRICT` — account deletion handler explicitly flips `other_party_deleted_at` instead of cascading (decision 4) |
| `dm_messages` | `id uuid PK` (= idempotency key), `dm_thread_id uuid FK ON DELETE CASCADE`, `author_id uuid FK NULL ON DELETE SET NULL`, `content text`, `sent_at`, `watermark bigint NOT NULL`, `edited_at timestamptz NULL`, `deleted_at timestamptz NULL`, `reply_to_message_id uuid NULL FK → dm_messages.id ON DELETE SET NULL`. Index: `(dm_thread_id, watermark DESC)` |
| `dm_unreads` | `user_id uuid`, `dm_thread_id uuid` — composite PK, `count int`, `last_read_message_id uuid NULL`. FKs `ON DELETE CASCADE` |
| `file_attachments` | `id uuid PK`, `uploader_id uuid FK NULL ON DELETE SET NULL`, `original_filename text`, `content_type text`, `size_bytes bigint`, `storage_path text`, `created_at`, `room_id uuid NULL FK ON DELETE CASCADE`, `dm_thread_id uuid NULL FK ON DELETE CASCADE`, `message_id uuid NULL FK → messages.id ON DELETE CASCADE`, `dm_message_id uuid NULL FK → dm_messages.id ON DELETE CASCADE`. Check: `(room_id IS NOT NULL) OR (dm_thread_id IS NOT NULL) OR (message_id IS NULL AND dm_message_id IS NULL)` — attachment is either scoped to a room, a DM thread, or pre-commit orphan |
| `password_reset_tokens` | `token uuid PK`, `user_id uuid FK ON DELETE CASCADE`, `created_at`, `expires_at`, `consumed_at timestamptz NULL` |

### Modified Phase 1 FK cascades

Phase 1 set `messages.author_id SET NULL` and `messages.room_id CASCADE`. Phase 2 sets additional cascades on user deletion (decision 4):

| FK | Cascade | Rationale |
|---|---|---|
| `rooms.created_by_id` | CASCADE | Owner deletion nukes their rooms → which cascades `messages`, `room_memberships`, `room_invitations`, `room_bans`, `file_attachments.room_id` |
| `room_memberships.user_id` | CASCADE | Memberships in others' rooms dissolve |
| `sessions.user_id` | CASCADE | Sessions go |
| `friendships.user_a_id` / `user_b_id` | CASCADE both | Friendship row removed |
| `user_bans.banner_user_id` / `banned_user_id` | CASCADE both | Ban row removed |
| `room_invitations.invitee_user_id` | CASCADE | Pending invites dropped |
| `dm_threads.user_a_id` / `user_b_id` | **RESTRICT** | Soft retention — account-delete handler flips `other_party_deleted_at` instead |
| `dm_messages.author_id` | SET NULL | DM history preserved for the surviving party |
| `file_attachments.uploader_id` | SET NULL | Files in other users' rooms persist as `[deleted user]` uploaded |

---

## Phase 2 Error codes

Additions to Phase 1's `NOT_MEMBER`, `ROOM_NOT_FOUND`, `MESSAGE_TOO_LARGE`:

**REST**: HTTP status + `{ error: "Human-readable message" }` — same envelope as Phase 1.

**Hub** error codes (dispatched via `Clients.Caller.SendAsync("Error", …)`):

| Code | When |
|------|------|
| `NOT_ADMIN` | Non-admin attempts admin-only hub action (e.g., delete another user's message) |
| `NOT_AUTHOR` | Non-author attempts to edit a message |
| `MESSAGE_NOT_FOUND` | Edit/delete target does not exist |
| `NOT_FRIENDS` | DM send/open where caller and target are not mutual friends |
| `USER_BANNED` | DM send where caller has banned target, or target has banned caller |
| `THREAD_FROZEN` | DM send to a thread with `frozen_at` or `other_party_deleted_at` set |
| `ROOM_BANNED` | Banned user attempts room hub action |
| `DM_THREAD_NOT_FOUND` | Hub action against non-existent thread |
| `INVALID_REPLY` | `replyToMessageId` references a message not in the same room/thread |

---

## Phase 2 auth extension

### POST /api/auth/login (extended)
Request body adds `keepMeSignedIn: boolean` (default `false` if omitted). Phase 1 shipped with always-persistent cookies; this field makes persistence opt-in.

```json
{ "email": "string", "password": "string", "keepMeSignedIn": false }
```

Cookie-lifetime semantics:
- `keepMeSignedIn: false` → session cookie (no `Expires` / `MaxAge`; browser clears on close). `AuthenticationProperties.IsPersistent = false`, `ExpiresUtc = null`.
- `keepMeSignedIn: true` → persistent cookie. `AuthenticationProperties.IsPersistent = true`, `ExpiresUtc = now + 30 days`, `SlidingExpiration = true` (matching Phase 1's `ExpireTimeSpan` config).

Response shape unchanged. Existing clients that omit the field get session-cookie behaviour.

---

## Phase 2 REST Endpoints

All require auth cookie. All mutating endpoints require `X-XSRF-TOKEN`. Pagination envelope (`{ items, nextCursor }`) matches Phase 1.

### Room moderation + private rooms

#### POST /api/rooms (extended)
Adds `isPrivate: boolean` to request body (default `false`). Private rooms are excluded from `GET /api/rooms` unless the caller is a member or has a pending invitation. All other response shape unchanged.

#### DELETE /api/rooms/{id}
Auth: owner only.
Broadcasts `RoomDeleted` hub event to `room-{id}` before the DB row is deleted (group dispatch first, then `SaveChangesAsync()` — members get the event, cascades do the rest).

Response 200: `{}`
Errors: `404 { "error": "Room not found" }` · `403 { "error": "Only the owner can delete a room" }`

#### GET /api/rooms/{id}/members
Auth: room member.
Response 200:
```json
{
  "items": [
    { "userId": "uuid", "username": "string", "role": "owner | admin | member", "joinedAt": "iso8601", "presence": "online | afk | offline" }
  ],
  "nextCursor": null
}
```
No pagination in Phase 2 (brief sizes rooms ≤ 1000 members; single-page fetch acceptable). `nextCursor` stays in the envelope for forward compatibility.

#### GET /api/rooms/{id}/bans
Auth: room owner/admin.
```json
{
  "items": [
    { "userId": "uuid", "username": "string", "bannedByUserId": "uuid", "bannedByUsername": "string", "bannedAt": "iso8601", "reason": "string | null" }
  ],
  "nextCursor": null
}
```

#### POST /api/rooms/{id}/members/{userId}/promote
Auth: room owner. Promotes member → admin.
Broadcasts `RoleChanged` to `room-{id}`.

Response 200: `{ "userId": "uuid", "role": "admin" }`
Errors: `403 { "error": "Only the owner can promote admins" }` · `404 { "error": "Member not found" }` · `400 { "error": "User is already an admin" }`

#### POST /api/rooms/{id}/members/{userId}/demote
Auth: room owner. Demotes admin → member.
Broadcasts `RoleChanged`.

Response 200: `{ "userId": "uuid", "role": "member" }`
Errors: same shape as promote + `400 { "error": "User is not an admin" }`

#### POST /api/rooms/{id}/members/{userId}/ban
Auth: room owner (any target) or admin (non-admin targets only).
Body: `{ "reason": "string | null" }`
Writes `room_bans` row, deletes `room_memberships` row, broadcasts `RoomBanned` hub event to the banned user (forces UI to exit) and `UserLeftRoom` to the group.

Response 200: `{}`
Errors: `403 { "error": "Insufficient role" }` (admin tries to ban owner/another admin) · `404 { "error": "Room not found" }` · `400 { "error": "User is not a member" }`

#### POST /api/rooms/{id}/members/{userId}/unban
Auth: room owner/admin. Deletes `room_bans` row. User can rejoin via normal join flow.

Response 200: `{}`
Errors: `404 { "error": "Ban not found" }`

### Room invitations

#### POST /api/rooms/{id}/invitations
Auth: private room owner/admin. Public rooms: 400 (no invitations needed).
Body: `{ "username": "string" }`
Writes `room_invitations` row (`status='pending'`), fires `RoomInvitationReceived` hub event to the invitee.

Response 201:
```json
{ "id": "uuid", "roomId": "uuid", "inviteeUserId": "uuid", "inviteeUsername": "string", "status": "pending", "createdAt": "iso8601" }
```
Errors: `404 { "error": "User not found" }` · `400 { "error": "User is already a member" }` · `400 { "error": "Invitation already pending" }` · `400 { "error": "Public rooms do not use invitations" }` · `403 { "error": "Only owner or admin can invite" }`

#### GET /api/invitations
Auth: caller. Lists the caller's incoming pending invitations.
```json
{
  "items": [
    { "id": "uuid", "roomId": "uuid", "roomName": "string", "invitedByUsername": "string", "createdAt": "iso8601" }
  ],
  "nextCursor": null
}
```

#### POST /api/invitations/{id}/accept
Auth: the invitee only. Inserts `room_memberships` (`role='member'`), flips invitation to `accepted`. Returns the joined room DTO (same shape as `GET /api/rooms/{id}`).

Errors: `404 { "error": "Invitation not found" }` · `400 { "error": "Invitation is not pending" }`

#### POST /api/invitations/{id}/decline
Flips invitation to `declined`. Response 200: `{}`.

### Messages — edit + delete

#### PATCH /api/messages/{id}
Auth: author only. Body: `{ "content": "string" }`.
Validates ≤ 3072 UTF-8 bytes (same as send).
Sets `edited_at = now()`, updates `content`. Broadcasts `MessageEdited` to `room-{roomId}`.

Response 200: full message DTO (same shape as `MessageReceived`).
Errors: `403 { "error": "Only the author can edit" }` · `404` · `400 { "error": "Message exceeds 3 KB" }` · `400 { "error": "Message is deleted" }`

#### DELETE /api/messages/{id}
Auth: author OR room admin/owner (brief 2.5.5).
Soft-delete: sets `deleted_at = now()`, clears `content` server-side. Broadcasts `MessageDeleted`. Subsequent reads return the row with `deletedAt` set and empty `content` — frontend renders placeholder.

Response 200: `{}`
Errors: `403 { "error": "Insufficient permission to delete" }` · `404`. Deleting already-deleted is 200 (idempotent).

#### SendMessage (hub) — extended
Request adds optional fields:
```ts
{ roomId: string, content: string, idempotencyKey: string, replyToMessageId?: string | null, attachmentFileIds?: string[] }
```
`replyToMessageId`: must reference a message in the same room. Hub validates and dispatches `Error { code: "INVALID_REPLY" }` on mismatch.
`attachmentFileIds`: array of `file_attachments.id` values that belong to this caller with `message_id IS NULL`. Hub sets `file_attachments.message_id = @newMessageId` for each on persist.

### Friends / contacts

#### GET /api/friends
```json
{
  "items": [
    { "userId": "uuid", "username": "string", "acceptedAt": "iso8601", "presence": "online | afk | offline", "isBanned": false, "isBannedBy": false, "dmThreadId": "uuid | null" }
  ],
  "nextCursor": null
}
```
`isBanned`: caller has banned this user. `isBannedBy`: this user has banned caller. `dmThreadId`: populated if a thread exists (eager hydration — cheap join, avoids an extra round-trip).

#### POST /api/friends/requests
Body: `{ "username": "string", "message": "string | null" }`
Writes `friendships` row (canonicalized, `status='pending'`). `requested_by_user_id` records direction. Fires `FriendRequestReceived` hub event to the other party.

Response 201: `{ "username": "string", "status": "pending" }`
Errors: `404 { "error": "User not found" }` · `400 { "error": "Cannot friend yourself" }` · `400 { "error": "Friend request already pending" }` · `400 { "error": "Already friends" }` · `400 { "error": "User has banned you" }` (if `user_bans` exists where target banned caller)

#### GET /api/friends/requests
Response:
```json
{
  "incoming": [
    { "userId": "uuid", "username": "string", "message": "string | null", "requestedAt": "iso8601" }
  ],
  "outgoing": [
    { "userId": "uuid", "username": "string", "requestedAt": "iso8601" }
  ]
}
```

#### POST /api/friends/requests/{userId}/accept
Caller is the invitee. Flips `friendships.status = 'accepted'`, sets `accepted_at`. Fires `FriendRequestAccepted` hub event to the other party. Response: `{ "userId": "uuid", "username": "string" }`.

#### POST /api/friends/requests/{userId}/decline
Deletes the pending `friendships` row. Fires `FriendRequestDeclined`. Response: `{}`.

#### DELETE /api/friends/{userId}
Removes friendship. Fires `FriendRemoved` hub event to the other party. DM thread (if any) persists but gets `frozen_at` left unchanged (friendship removal alone does not freeze; only user-ban does). Response: `{}`.

#### POST /api/friends/{userId}/ban
Writes `user_bans(banner=caller, banned=userId)`. Sets `dm_threads.frozen_at = now()` on the thread with this user (if exists). Fires `UserBanned` hub event to the banned user. Response: `{}`.

#### DELETE /api/friends/{userId}/ban
Removes `user_bans` row. Clears `dm_threads.frozen_at` **only if** no reverse ban exists. Response: `{}`.

### Direct Messages

#### POST /api/dms/open
Body: `{ "userId": "uuid" }`
Ensures a `dm_threads` row exists with the caller + target (creates on conflict do nothing, then returns). Rejects with 403 if caller and target are not mutual friends, or if any `user_bans` row exists between them.

Response 200:
```json
{ "id": "uuid", "otherUser": { "userId": "uuid", "username": "string", "presence": "online | afk | offline" }, "frozenAt": null, "otherPartyDeletedAt": null, "currentWatermark": 0 }
```

#### GET /api/dms
List caller's DM threads, ordered by most recent activity.
```json
{
  "items": [
    { "id": "uuid", "otherUser": {...}, "lastMessagePreview": "string | null", "lastActivityAt": "iso8601", "unreadCount": 0, "frozenAt": null, "otherPartyDeletedAt": null }
  ],
  "nextCursor": "string | null"
}
```

#### GET /api/dms/{threadId}
Auth: thread participant. Same DTO shape as `POST /api/dms/open` response.

#### GET /api/dms/{threadId}/messages
Same contract as `GET /api/rooms/{id}/messages` — `before` / `since` / `limit`, cursor pagination on thread-scoped watermark. Response item shape matches room message DTO plus `dmThreadId` replacing `roomId`.

### Files

#### POST /api/files
Auth: caller. CSRF: required. Multipart form data:
- `file`: binary
- `scope`: `"room" | "dm"` (informational — access is still resolved at download time)
- `scopeId`: `roomId` or `dmThreadId` that the caller must already be a member of / participant in
- `originalFilename`: string (taken from the multipart filename if omitted)

Validates size: 20 MB for any file; 3 MB for images (`Content-Type` starts with `image/`). Persists to filesystem `/var/chat-files/{yyyy}/{mm}/{fileId}`. Inserts `file_attachments` row with `message_id = NULL`, `dm_message_id = NULL`, `room_id` or `dm_thread_id` set.

Response 201:
```json
{ "id": "uuid", "originalFilename": "string", "contentType": "string", "sizeBytes": 0, "scope": "room | dm", "scopeId": "uuid" }
```
Errors: `413 { "error": "File exceeds 20 MB" }` · `413 { "error": "Image exceeds 3 MB" }` · `403 { "error": "Not a member" }` / `403 { "error": "Not a DM participant" }` · `400 { "error": "Scope id required" }`

#### GET /api/files/{id}
Auth: caller must be a current member of the file's room (if `room_id` set) OR participant in the file's DM thread (if `dm_thread_id` set) OR the uploader (pre-commit pickup). Access result cached 30 s in `MemoryCache` keyed by `(userId, fileId)`. Streams binary with:
- `Content-Type: <stored>`
- `Content-Disposition: inline; filename="<original>"` (browsers treat image inline, non-image as download)

Errors: `403 { "error": "Access denied" }` · `404 { "error": "File not found" }` · `410 { "error": "File has been removed" }` (row deleted but FS cleanup lag — shouldn't happen if cascades work, included for robustness)

### Sessions

#### GET /api/auth/sessions
```json
{
  "items": [
    { "id": "uuid", "userAgent": "string | null", "ipAddress": "string | null", "createdAt": "iso8601", "lastSeenAt": "iso8601", "isCurrent": true }
  ],
  "nextCursor": null
}
```
`isCurrent` is true for the session backing this HTTP call. Revoked sessions are not returned.

#### POST /api/auth/sessions/{id}/revoke
Marks session revoked. If the revoked session is the current one, also clears the `.chat.session` cookie in the response. Response 200: `{}`.

### Password

#### POST /api/auth/change-password
Body: `{ "currentPassword": "string", "newPassword": "string" }`
Verifies `currentPassword` via `IPasswordHasher`. Updates hash. Does **not** revoke other sessions (brief doesn't require it — session revocation stays manual via Sessions UI).

Response 200: `{}`
Errors: `400 { "error": "Current password incorrect" }` · `400 { "error": "Password must be at least 6 characters" }`

#### POST /api/auth/forgot-password
Body: `{ "email": "string" }`
Always returns 200 with a token (even for unknown email — real tokens are only valid for existing users; unknown-email returns a fake token to avoid user enumeration).

Response 200:
```json
{ "resetToken": "uuid", "expiresAt": "iso8601" }
```
(Hackathon convention — the token is displayed on-screen in lieu of email delivery.)

#### POST /api/auth/reset-password
Body: `{ "token": "uuid", "newPassword": "string" }`
Consumes token (`consumed_at = now()`), sets new hash. Revokes all sessions for the user (explicit: set `is_revoked = true` on every `sessions` row for this user).

Response 200: `{}`
Errors: `400 { "error": "Token invalid or expired" }` · `400 { "error": "Password must be at least 6 characters" }`

### Account

#### DELETE /api/auth/me
Body: `{ "password": "string" }`
Verifies password. In a single transaction:
1. Flip `dm_threads.other_party_deleted_at = now()` on every thread where user is a participant.
2. Set `dm_messages.author_id = NULL` for every message authored by user.
3. `_db.Users.Remove(user); await SaveChangesAsync();` — FK cascades handle rooms, memberships, friendships, user_bans, sessions, file_attachments.uploader_id (SET NULL).

Response 200: `{}` + cookie cleared.
Errors: `400 { "error": "Password incorrect" }`

---

## Phase 2 SignalR additions

### Client → Server

#### EditMessage
```ts
{ messageId: string, content: string }
```
Room context inferred from the message. Permission check: caller is author.
Rejects: `NOT_AUTHOR`, `MESSAGE_NOT_FOUND`, `MESSAGE_TOO_LARGE`.
On success broadcasts `MessageEdited`; returns the updated message DTO.

#### DeleteMessage
```ts
{ messageId: string }
```
Permission: author OR room admin/owner.
Rejects: `NOT_ADMIN`, `MESSAGE_NOT_FOUND`.
On success broadcasts `MessageDeleted`; returns `{ id, deletedAt }`.

#### JoinDm
```ts
{ threadId: string }
```
Adds caller to `dm-{threadId}` group. Validates caller is a participant. Rejects `DM_THREAD_NOT_FOUND`.
Returns `{ currentWatermark: number }`.

#### LeaveDm
```ts
{ threadId: string }
```

#### SendDirectMessage
```ts
{ threadId: string, content: string, idempotencyKey: string, replyToMessageId?: string | null, attachmentFileIds?: string[] }
```
Validates: participant, thread not `frozen_at` / `other_party_deleted_at`, content size, friendship + no-ban (re-checked at send, not just at thread open).
Rejects: `NOT_FRIENDS`, `USER_BANNED`, `THREAD_FROZEN`, `MESSAGE_TOO_LARGE`, `INVALID_REPLY`.
Broadcasts `DirectMessageReceived`. Returns persisted DM DTO.

#### EditDirectMessage / DeleteDirectMessage
Same shape as room variants; permission = author only (no admin concept in DMs). DM broadcasts `DirectMessageEdited` / `DirectMessageDeleted`.

### Server → Client

#### MessageEdited
To: `room-{roomId}`
```ts
{
  id: string, roomId: string, authorId: string, authorUsername: string,
  content: string, sentAt: string, idempotencyKey: string, watermark: number,
  editedAt: string, deletedAt: null, replyToMessageId: string | null,
  attachments: FileAttachmentDto[]
}
```

#### MessageDeleted
To: `room-{roomId}`
```ts
{ id: string, roomId: string, deletedAt: string }
```

#### DirectMessageReceived
To: `dm-{threadId}`. Same field shape as `MessageReceived` with `dmThreadId` replacing `roomId`.

#### DirectMessageEdited / DirectMessageDeleted
Same shapes as room variants, scoped to `dm-{threadId}`.

#### RoomInvitationReceived
To: personal user group `user-{userId}` (new group added in Phase 2 — caller auto-joins in `OnConnectedAsync`).
```ts
{ invitationId: string, roomId: string, roomName: string, invitedByUsername: string, createdAt: string }
```

#### RoomDeleted
To: `room-{roomId}` (broadcast immediately before the row is deleted).
```ts
{ roomId: string }
```

#### RoomBanned
To: `user-{bannedUserId}`.
```ts
{ roomId: string, bannedByUsername: string, reason: string | null }
```

#### RoleChanged
To: `room-{roomId}`.
```ts
{ userId: string, roomId: string, role: 'owner' | 'admin' | 'member' }
```

#### FriendRequestReceived
To: `user-{toUserId}`.
```ts
{ fromUserId: string, fromUsername: string, message: string | null, requestedAt: string }
```

#### FriendRequestAccepted
To: `user-{requesterUserId}`.
```ts
{ userId: string, username: string, acceptedAt: string, dmThreadId: string | null }
```

#### FriendRequestDeclined
To: `user-{requesterUserId}`.
```ts
{ userId: string }
```

#### FriendRemoved
To: `user-{otherUserId}`.
```ts
{ userId: string }
```

#### UserBanned
To: `user-{bannedUserId}`.
```ts
{ byUserId: string, byUsername: string, bannedAt: string }
```

#### PresenceChanged (extended)
Unchanged payload shape — Phase 2 now emits `'afk'` in addition to `'online'` / `'offline'`. Phase 1's reserved enum value activates here.

### Hub group additions

| Group | Joined when | Purpose |
|-------|-------------|---------|
| `room-{roomId}` | `JoinRoom` (Phase 1) | Room message + presence broadcasts |
| `dm-{threadId}` | `JoinDm` | DM message broadcasts |
| `user-{userId}` | `OnConnectedAsync` auto-joins for the connected user | Personal notifications: invitations, friend requests, user-ban, room-ban, room-delete |

`user-{userId}` group is the plumbing for personal notifications that are not room-scoped. Auto-join in `OnConnectedAsync` keeps the hub API symmetric (caller never invokes a `JoinUser`).

---

# API Contracts — Phase 3

> **Status: DRAFT — locks when reviewed.**
> Additive to Phase 2. Phase 1 / Phase 2 sections above are LOCKED and unchanged.

---

## MSW behavior parity clause (retrospective — applies to all phases)

For every endpoint that returns **conditional response data** — filtering, access control, permission gating, role-gated fields — MSW handlers in `web/src/mocks/handlers.ts` MUST implement the same conditional logic as the real backend. Shape parity alone (matching DTO fields) is insufficient.

Examples:
- `GET /api/rooms` must filter out private rooms that the caller is not a member or invitee of. Both backend and MSW implement this filter — not just the response envelope shape.
- `DELETE /api/messages/{id}` permission check (author OR room admin/owner) must evaluate in MSW using the same logic the backend uses — not a blanket "200 OK if the id exists."
- `GET /api/files/{id}` access control (room member, DM participant, or pre-commit uploader) must hold in MSW — not just stream any placeholder binary.

This clause is recorded here after Phase 2 shipped with several handlers matching DTO shape but not conditional behavior. The resulting bugs (e.g., Bug 1 in `docs/known-bugs.md`) were invisible during MSW-only development and surfaced only against the real backend. The clause is **binding on all future handlers added at any phase**.

---

## Phase 3 SignalR additions

Three new events. One new group. No new REST endpoints.

### Hub group additions

| Group | Joined when | Purpose |
|-------|-------------|---------|
| `public-rooms-catalog` | `OnConnectedAsync` auto-joins every connected user | Broadcast new/deleted public rooms to viewers of the catalog |

`user-{userId}` (Phase 2) and `public-rooms-catalog` (Phase 3) are both auto-joined in `OnConnectedAsync`. Clients do not invoke a `Join*` method for either.

### Server → Client

#### RoomCreated
To: `public-rooms-catalog`.
Fired from: `POST /api/rooms` on success, **only when `isPrivate == false`**. Private rooms do not broadcast.
```ts
{
  id: string,
  name: string,
  description: string,
  memberCount: number,      // 1 (the creator, joined as owner)
  isMember: false,           // from the perspective of every recipient in the group
  isPrivate: false,          // always false for this event
  myRole: null               // recipients are not members
}
```
**Per-recipient perspective note:** `isMember` / `myRole` are not genuinely per-recipient here — since private rooms are excluded and the creator receives their own event too (but is already rendering the room from the POST response, so UI is idempotent via query-cache dedup), the fixed values `isMember: false, myRole: null` are safe. Frontend handler invalidates `['rooms']` query key; the next catalog refetch returns accurate `isMember` for the creator.

#### RoomDeleted (fanout extended)
Phase 2 contract unchanged: broadcast to `room-{roomId}` before the DB row is deleted.

**Phase 3 extension:** in addition to `room-{roomId}`, broadcast **also** to `public-rooms-catalog` when the deleted room was public (`isPrivate == false`). Private rooms broadcast only to `room-{roomId}` as before.

Payload unchanged:
```ts
{ roomId: string }
```

Order of operations on `DELETE /api/rooms/{id}`:
1. Read `isPrivate` on the room (before deletion).
2. Broadcast to `room-{roomId}` (Phase 2 behavior).
3. If `isPrivate == false`, also broadcast to `public-rooms-catalog` (Phase 3 addition).
4. `SaveChangesAsync()` — cascade deletes fire.

Broadcasting before the DB save is deliberate — after save, the group membership is still alive (connections persist), but the row is gone. Either order works for `room-{roomId}` subscribers (client only needs the id); the pattern matches Phase 2 for consistency.

#### DmThreadCreated
To: `user-{userA}` **and** `user-{userB}`.
Fired from: `POST /api/dms/open` **only on first-time thread creation** (when the `ON CONFLICT DO NOTHING RETURNING id` pattern actually inserts a new row). If the thread already existed, no broadcast.

Payload (per-recipient: `otherUser` is always the *other* participant from the recipient's perspective):
```ts
{
  id: string,
  otherUser: { userId: string, username: string, presence: 'online' | 'afk' | 'offline' },
  lastMessagePreview: null,
  lastActivityAt: string,     // same as created_at for a just-created thread
  unreadCount: 0,
  frozenAt: null,
  otherPartyDeletedAt: null
}
```

Server implementation note: the endpoint must dispatch two separate `Clients.Group(...).SendAsync` calls with per-recipient payloads (shaped for each user's `otherUser` field). Do not broadcast a single shared payload — `otherUser` is not symmetric.

Frontend handler (`useGlobalHubEvents`): invalidate `['dms']` query key. The payload itself could be merged into the cache, but invalidation is simpler and the cost of one extra GET is ~1 KB; prefer invalidation until it measurably matters.

---

## Phase 3 REST additions

None. Phase 3 real-time features reuse existing Phase 1 / Phase 2 REST endpoints (`POST /api/rooms`, `DELETE /api/rooms/{id}`, `POST /api/dms/open`) and only add new broadcast sites in the handlers.

---

## Phase 3 XMPP integration — shipped (option d, bidirectional + S2S)

**Landed at fallback (d) bidirectional** plus bonus S2S federation between two ejabberd instances.

**No new public REST endpoints.** The bridge is an internal `BackgroundService` (`api/Features/XmppBridge/XmppBridgeService.cs`) that:
1. Connects to ejabberd as `bridge-bot@chat.local` using configured credentials.
2. Subscribes to `bridge@conference.chat.local` MUC.
3. On each received MUC `groupchat` stanza, writes a row into `messages` for the configured bridge room with `authorUsername = "xmpp:{nick}"` and upserts a non-loginable system user for that nick.
4. Broadcasts `MessageReceived` via `IHubContext<ChatHub>` so connected clients see the bridged message live.
5. On each app `MessageReceived` in the bridge room, publishes the message to a bounded `Channel<(string,string)>(200, DropOldest)` which a writer task drains to ejabberd, prefixed `[{username}]:`.

**Configuration (docker-compose env vars on the `api` service):**
- `XMPP__HOST` — ejabberd hostname (`ejabberd`).
- `XMPP__USERNAME` / `XMPP__PASSWORD` — bridge credentials (`bridge-bot` / `Bridge123!`).
- `XMPP__MUC` — `bridge@conference.chat.local`.
- `XMPP__BRIDGE_ROOM_ID` — UUID of the app room to mirror into.

**ejabberd services:**

| Service | Domain | Ports (host) | Container IP |
|---------|--------|--------------|--------------|
| `ejabberd` | `chat.local` | 5222, 5269, 5280 | 172.26.0.10 |
| `ejabberd-fed` | `fed.local` | 5223 (c2s), 5270 (s2s) | 172.26.0.11 |

Both services share `ejabberd/inetrc` which points Erlang's `inet_res` at Docker's embedded DNS (127.0.0.11). `conference.chat.local` and `conference.fed.local` are Docker network aliases on their respective containers — required for S2S MUC subdomain resolution.

**S2S federation:** `ejabberd` and `ejabberd-fed` authenticate via `mod_s2s_dialback` with `s2s_use_starttls: false` (safe inside Docker bridge network). `gajim-user-fed@fed.local` can join `bridge@conference.chat.local` and their messages bridge into the app identically to local accounts.

**Pre-registered accounts (via `ejabberd-setup` / `ejabberd-fed-setup` one-shot containers):**
- `bridge-bot@chat.local` / `Bridge123!` — the bridge service account
- `gajim-user-a@chat.local`, `gajim-user-b@chat.local` / `Test123!` — demo Gajim accounts
- `gajim-user-fed@fed.local` / `Test123!` — federated demo account

---

## Phase 3 error codes

No new hub error codes. Phase 3 does not introduce new hub `Client → Server` methods — only new `Server → Client` events, which do not produce errors.

If Slice 7 ships with the bridge, the bridge's failures are logged (Serilog), not surfaced to chat clients — bridged-in messages just stop appearing. This matches the brief's federation-reliability expectations (federation isn't chat's hard real-time path).

---

## Phase 3 DB schema

No new tables. No new columns. Phase 2's schema is sufficient for Phase 3 real-time features.

If Slice 7 ships with the bridge, the bridged messages reuse the existing `messages` table — see bridge configuration above. No new persistence model.

