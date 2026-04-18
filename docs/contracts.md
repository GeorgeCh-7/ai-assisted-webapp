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
