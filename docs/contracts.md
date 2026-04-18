# API Contracts — Phase 1

> **Status: DRAFT — lock this before Track A or Track B writes code.**
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

Every non-2xx response uses exactly this shape:
```json
{ "error": "Human-readable message" }
```
No machine-readable codes in Phase 1.

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
Omit `cursor` → first page.

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
Response 200:
```json
{ "id": "uuid", "username": "string", "email": "string" }
```
Errors: `400 { "error": "Username already taken" }` · `400 { "error": "Email already registered" }` · `400 { "error": "Password does not meet requirements" }`

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
Creator is automatically joined as a member.

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
Adds caller to `room-{roomId}`. Hub validates DB membership. On success broadcasts `UserJoinedRoom`.
**Returns to caller:** `{ currentWatermark: number }` — the room's latest watermark at join time. Client stores this and compares against `lastSeenWatermark` on reconnect to detect gaps.

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

#### Heartbeat
```ts
{}
```
Updates `user_presence.last_heartbeat_at` for the caller. No broadcast; no effect on online/offline state. Online/offline is driven by `OnConnectedAsync` / `OnDisconnectedAsync` with per-user connection ref-counting so multi-tab users stay online while any tab is connected. Heartbeat is reserved for Phase 2 AFK detection: **brief 2.2.2 defines AFK as ≥ 60 s without activity across all tabs**. Phase 2 sweeper transitions users to AFK when `max(last_heartbeat_at) across their connections` is older than 60 s, and back to `online` on the next heartbeat. Client should send a heartbeat on any user interaction (mousemove/keypress/focus), debounced to ~15 s.

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
Hub methods never throw to callers. On rejection, send to caller only:
```ts
// shape
{ code: string, message: string }
// event name
"Error"
```
Frontend listens for `"Error"` and surfaces inline. Phase 1 codes: `NOT_MEMBER`, `ROOM_NOT_FOUND`, `MESSAGE_TOO_LARGE`.

---

## DB Schema (reference — Track A owns, Track B uses DTO shapes above)

Managed by `EnsureCreated()`. Snake_case via `EFCore.NamingConventions`. Identity tables renamed in `OnModelCreating`.

| Table | Key columns |
|-------|-------------|
| `users` | `id uuid`, `user_name text`, `email text`, `password_hash text` |
| `user_claims` | Identity default, renamed |
| `sessions` | `id uuid PK`, `user_id uuid FK`, `created_at`, `last_seen_at`, `is_revoked bool`, `user_agent text NULL`, `ip_address inet NULL` |
| `rooms` | `id uuid PK`, `name text UNIQUE`, `description text`, `created_at`, `created_by_id uuid FK`, `current_watermark bigint NOT NULL DEFAULT 0` |
| `room_memberships` | `room_id uuid`, `user_id uuid` — composite PK, `joined_at` |
| `messages` | `id uuid PK` (= idempotency key), `room_id uuid FK ON DELETE CASCADE`, `author_id uuid FK NULL ON DELETE SET NULL`, `content text`, `sent_at`, `watermark bigint NOT NULL` |
| `user_presence` | `user_id uuid PK`, `status text`, `last_heartbeat_at` |
| `room_unreads` | `user_id uuid`, `room_id uuid` — composite PK, `count int`, `last_read_message_id uuid` |

Index: `ix_messages_room_watermark` on `(room_id, watermark DESC)` — required for efficient cursor pagination. Add via `HasIndex` in `OnModelCreating`.

**Cascade rationale:** `messages.author_id` is nullable with `ON DELETE SET NULL` so Phase 2 account deletion doesn't need to fan out into every historical message. The author-mapping layer substitutes a `[deleted user]` placeholder username when `author_id` is null — DTOs keep `authorId` / `authorUsername` non-nullable for Phase 1 consumers. `messages.room_id` cascades on room deletion (Phase 2 room delete nukes its history in one statement). These behaviors must be set on the FK relationships in `OnModelCreating` — EF Core defaults would `Restrict` and break Phase 2 deletion flows.
