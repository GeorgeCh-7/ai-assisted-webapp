# Feature Spec: Phase 1 — Foundation + Core Chat

## Goal

Stand up the full vertical slice: two authenticated users can exchange real-time messages in a public room and see each other's online/offline presence within 2 seconds.

## User-visible Outcome

A user opens the app, registers or logs in, browses the public room catalog (with search), joins a room, and exchanges messages in real time with another user in a second browser tab. An online indicator shows when the other user is connected. Unread counts appear on rooms with unseen messages and clear on open.

## Context

- Roadmap phase: [Phase 1](../roadmap.md#phase-1-foundation--core-chat-day-1-am)
- Depends on: nothing — this is the foundation
- Explicit out of scope for this phase: AFK state, private rooms, friend system, DMs, file sharing, message edit/delete, reply/quote, active session management, password reset, account deletion

---

## Prerequisite: Lock docs/contracts.md

**Neither track writes code until `docs/contracts.md` is locked.**

`docs/contracts.md` is the single source of truth for:
- Every Phase 1 REST endpoint (method, path, request body, response shape, error cases)
- Every ChatHub method in both directions with full payload shapes
- Error envelope shape
- Auth contract: cookie name, SameSite policy, CSRF cookie + header names, `/api/auth/me` shape
- Cursor-based pagination shape

Track B mocks against it. Track A implements against it. Any change to contracts.md after lock requires agreement from both tracks — propose it in chat, don't just edit.

---

## Files to Create / Modify

### Track A — Backend

**New:**
```
api/Domain/AppUser.cs
api/Domain/AppSession.cs
api/Domain/Room.cs
api/Domain/RoomMembership.cs
api/Domain/Message.cs
api/Domain/UserPresence.cs
api/Domain/RoomUnread.cs
api/Features/Auth/AuthEndpoints.cs
api/Features/Auth/AuthDto.cs
api/Features/Rooms/RoomsEndpoints.cs
api/Features/Rooms/RoomDto.cs
api/Features/Messages/MessagesEndpoints.cs
api/Features/Messages/MessageDto.cs
api/Hubs/ChatHub.cs
api/Features/Presence/PresenceService.cs
api/Infrastructure/Argon2PasswordHasher.cs
api.Tests/Auth/AuthEndpointsTests.cs
api.Tests/Auth/SessionValidationTests.cs
api.Tests/Messages/MessageDeduplicationTests.cs
api.Tests/Rooms/RoomMembershipTests.cs
api.Tests/Hubs/ChatHubTests.cs
```

**Modified:**
```
api/Data/AppDbContext.cs     — add all DbSets, OnModelCreating rename + snake_case
api/Program.cs              — Serilog, Identity, Antiforgery, SignalR, route groups
api/Api.csproj              — NuGet packages (see Notes)
```

### Track B — Frontend

**New:**
```
web/src/lib/api.ts                              — fetch wrapper: credentials, CSRF header, error parsing
web/src/lib/queryClient.ts                      — TanStack Query client instance
web/src/mocks/handlers.ts                       — MSW handlers for every contracts.md endpoint
web/src/mocks/browser.ts                        — MSW worker setup
web/src/features/auth/LoginPage.tsx
web/src/features/auth/RegisterPage.tsx
web/src/features/auth/useAuth.ts                — useMe, useLogin, useRegister, useLogout
web/src/features/auth/types.ts
web/src/features/rooms/RoomCatalogPage.tsx
web/src/features/rooms/CreateRoomModal.tsx
web/src/features/rooms/useRooms.ts              — useRooms, useRoom, useJoinRoom, useLeaveRoom, useCreateRoom
web/src/features/rooms/types.ts
web/src/features/chat/ChatWindow.tsx
web/src/features/chat/MessageList.tsx
web/src/features/chat/MessageComposer.tsx
web/src/features/chat/useMessages.ts            — useMessageHistory, useSendMessage
web/src/features/chat/useSignalR.ts             — connection lifecycle, reconnect, event subscriptions
web/src/features/chat/types.ts
web/src/features/presence/PresenceIndicator.tsx
web/src/features/presence/usePresence.ts
web/src/hooks/useHeartbeat.ts                   — multi-tab heartbeat sender
web/src/hooks/useUnread.ts
```

**Modified:**
```
web/src/main.tsx     — QueryClientProvider, MSW conditional start
web/src/App.tsx      — router, protected routes
web/package.json     — add msw, @microsoft/signalr
```

---

## Parallel Tracks

### Port Coordination

Docker Compose can only bind ports in one worktree at a time. **Track A owns the running stack** (`docker compose up --build` lives in Track A's worktree). Track B develops exclusively against MSW until the integration gate. Track B sets `VITE_API_URL=http://localhost:5080` in `.env.local` but keeps `VITE_MSW_ENABLED=true` until integration day.

### Track A — Backend (.NET 9 Minimal API)

**Merge 1 checkpoint** (target: ~2 h):
- Serilog wired; SignalR connection ID enriched on every log entry
- `AppDbContext` with all Phase 1 entities; `EFCore.NamingConventions` snake_case; Identity tables renamed in `OnModelCreating`
- Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — cookie issued, CSRF seeded
- `AppSession` row created on login, revoked on logout
- `OnValidatePrincipal` check: load session from DB, reject if `is_revoked = true`
- Argon2id `IPasswordHasher<AppUser>` registered (last registration wins over Identity default)
- Antiforgery configured; all mutating routes validated
- → **Merge to `main`**

**Merge 2 checkpoint** (target: ~4 h after Merge 1):
- `ChatHub` — `[Authorize]`, `OnConnectedAsync` / `OnDisconnectedAsync`, `JoinRoom`, `LeaveRoom`, `SendMessage` with idempotency dedup, `Heartbeat`
- `JoinRoom` returns `{ currentWatermark: long }` to caller
- Watermark: on each `SendMessage`, atomically `UPDATE rooms SET current_watermark = current_watermark + 1 WHERE id = @roomId RETURNING current_watermark` (in a transaction); assign result to `Message.Watermark`
- `Room.CurrentWatermark` and `Message.Watermark` columns in schema; `HasIndex(m => new { m.RoomId, m.Watermark })` in `OnModelCreating` (required for pagination performance at 100K+ rows)
- Presence service: online on first connection, offline on last disconnect, `PresenceChanged` broadcast
- Room CRUD: `GET /api/rooms` with search + cursor pagination, `POST /api/rooms`, `GET /api/rooms/{id}`, `POST /api/rooms/{id}/join`, `POST /api/rooms/{id}/leave`
- Message history: `GET /api/rooms/{id}/messages` with `before={watermark}` (DESC) and `since={watermark}` (ASC) — member-only gate
- `RoomUnread`: increment on `MessageReceived`, reset on `JoinRoom`
- Tests:
  - Auth + session validation (existing)
  - Message deduplication (existing)
  - Room membership rules (existing)
  - ChatHub integration (existing)
  - **Pagination correctness:** seed a room with 200 messages (watermarks 1–200); assert `GET ?limit=50` returns watermarks 200–151 (DESC); use `nextCursor` to fetch watermarks 150–101, 100–51, 50–1; assert final page has `nextCursor: null`; assert `GET ?before=100` returns watermarks 99–50; assert `GET ?since=150` returns watermarks 151–200 (ASC)
- All xUnit tests green
- → **Merge to `main`**

### Track B — Frontend (React + Vite + TS)

**Merge 1 checkpoint** (target: ~2 h):
- Vite scaffold: Tailwind initialized, shadcn components installed (Button, Input, Card, Dialog, Badge), `@tanstack/react-query` wired
- `lib/api.ts`: fetch wrapper with `credentials: 'include'`, reads `XSRF-TOKEN` cookie, adds `X-XSRF-TOKEN` header on mutations, parses error envelope
- MSW configured; `handlers.ts` covers every auth endpoint from contracts.md with realistic mock data
- `LoginPage` + `RegisterPage` functional against MSW
- `useAuth` hooks: `useMe`, `useLogin`, `useRegister`, `useLogout`
- Protected route guard: unauthenticated users redirect to `/login`; `useMe` acts as the auth bootstrap
- → **Merge to `main`**

**Merge 2 checkpoint** (target: ~4 h after Merge 1):
- MSW handlers cover all remaining Phase 1 endpoints (rooms, messages, presence)
- `RoomCatalogPage`: lists rooms with search input, join/leave buttons, create-room modal
- `ChatWindow`: `MessageList` (chronological display, scroll-to-bottom on new message) + `MessageComposer` (Enter to send, Shift+Enter for newline, optimistic insert)
- `useSignalR`: connection with cookie auth, auto-reconnect (`withAutomaticReconnect`), forwards `MessageReceived` / `PresenceChanged` / `UserJoinedRoom` / `UserLeftRoom` events into React Query cache; tracks `lastSeenWatermark` per room (updated on each `MessageReceived`)
- Gap detection on reconnect: `onreconnected` callback re-invokes `JoinRoom` and compares returned `currentWatermark` against `lastSeenWatermark`. If `currentWatermark > lastSeenWatermark`, loop `GET /api/rooms/{id}/messages?since={cursor}` — initial `cursor = lastSeenWatermark`, subsequent `cursor = response.nextCursor` — until `nextCursor === null`, merging each page into the message cache. Single-shot (`limit=50`) leaves messages missing when gaps exceed 50. Live `MessageReceived` events arriving during backfill are dedup'd by `id` (= `idempotencyKey`), so overlap between backfill pages and the live stream is safe
- `useSendMessage`: generates `idempotencyKey` once, retries with same key (TanStack Query `retry: 3`); on SignalR reconnect, re-sends any message pending at disconnect
- `useMessageHistory` uses `useInfiniteQuery`; `getNextPageParam` returns `nextCursor` (the oldest watermark on the page); `MessageList` attaches an intersection observer to the top sentinel element to trigger `fetchNextPage` as the user scrolls up
- `useHeartbeat`: sends `Heartbeat()` every 15 s (no payload). Online/offline is driven by the hub's per-user connection ref-count in `OnConnectedAsync` / `OnDisconnectedAsync`, not by heartbeats — multi-tab users stay online while any tab is connected. Heartbeat only touches `user_presence.last_heartbeat_at` for future AFK detection in Phase 2
- `PresenceIndicator`: green dot = online, grey = offline — driven by `PresenceChanged` events
- `useUnread`: increments per-room count on `MessageReceived` when room is not focused; resets to 0 when room is opened
- All acceptance tests pass against MSW
- → **Merge to `main`**

### Integration Gate

After both tracks reach Merge 2:

1. Track A: `docker compose up --build` in its worktree; confirm `http://localhost:5080/health` is green.
2. Track B: set `VITE_MSW_ENABLED=false`; `npm run dev`; confirm `http://localhost:5173` loads.
3. Run the gate test manually (see Scorecard item 4).
4. Fix integration issues in the relevant worktree; merge fixes to `main`.

---

## Scorecard

- [ ] **Contracts locked before code.** `docs/contracts.md` is committed and both track agents reference it. No REST shape or hub payload is defined in any other document.

- [ ] **Track B passes acceptance tests against MSW before touching real backend.** Every endpoint in contracts.md has an MSW handler. Running the app with `VITE_MSW_ENABLED=true` exercises the full UI flow (register → login → browse rooms → join → send message → see presence) without the API running.

- [ ] **Each track merges to `main` at least twice before the integration gate.** Track A: Merge 1 (auth + schema) and Merge 2 (hub + rooms + messages). Track B: Merge 1 (auth screens) and Merge 2 (chat + SignalR + presence). The integration gate is not the first merge for either track.

- [ ] **Integration gate passes against real backend.** Open **two separate browser profiles** — or one normal window + one incognito window. Two tabs in the same profile share the `.chat.session` cookie and can't hold two user sessions simultaneously. Log in as two different users; both join the same public room; each sends three messages; messages appear in both views in chronological order; each sender's presence toggles offline → online within 2 s of connecting **and** online → offline within 5 s of closing their last window. Test runs against `docker compose up`, not MSW.

- [ ] **Multi-tab presence stays online while any tab is open.** In profile A, log in as user A and open the chat room in two tabs. In profile B, log in as user B and observe user A shows online. Close one of user A's tabs; user B's view still shows user A online. Close the remaining tab; within 5 s user B's view flips user A to offline. Verifies the hub ref-counts connections per user rather than flipping offline on any single disconnect.

- [ ] **Server-side dedup holds under concurrent same-key sends.** Drive the hub from a scripted test: open a SignalR connection, invoke `SendMessage` 10× in parallel (`Promise.all`) with the **same** `idempotencyKey` and `roomId`. Assert: exactly one row exists in `messages` with `id = idempotencyKey`; no invoke throws; all 10 callers receive a resolved ack. This is the actual race (TanStack Query retry racing with `onreconnected` resubmit); the naive `AnyAsync + Add` path fails it with a unique-violation.

---

## Out of Scope

- AFK presence state (Phase 2)
- Private rooms and invitation flow (Phase 2)
- Friend/contact system and DMs (Phase 2)
- File and image sharing (Phase 2)
- Message edit, delete, reply/quote (Phase 2)
- Active session list and per-session logout UI (Phase 2)
- Password reset and account deletion (Phase 2)
- Room moderation: ban/unban, admin roles (Phase 2)
- Auth, tests, CI — tests ARE in scope for Phase 1 per roadmap; all other CLAUDE.md "never add" items remain excluded

---

## Notes

### Auth stack wiring (Track A)
```
builder.Services
    .AddIdentityCore<AppUser>(opts => { opts.Password.RequireNonAlphanumeric = false; })
    .AddEntityFrameworkStores<AppDbContext>();
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddIdentityCookies();
builder.Services.AddAntiforgery(opts => opts.HeaderName = "X-XSRF-TOKEN");
builder.Services.AddSingleton<IPasswordHasher<AppUser>, Argon2PasswordHasher>();
// ^ last registration wins over Identity's default BCrypt hasher
```

Cookie config:
```csharp
builder.Services.ConfigureApplicationCookie(opts => {
    opts.Cookie.Name = ".chat.session";
    opts.Cookie.SameSite = SameSiteMode.Lax;
    opts.Cookie.HttpOnly = true;
    opts.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    opts.Events.OnValidatePrincipal = SessionValidation.ValidateAsync; // custom — checks sessions table
});
```
`OnRedirectToLogin` override is critical: default behaviour redirects to a login page that doesn't exist; instead return 401 JSON.

### Snake_case + Identity table rename (Track A)
```csharp
// AppDbContext.OnModelCreating
builder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());
base.OnModelCreating(builder);
builder.Entity<AppUser>().ToTable("users");
builder.Entity<IdentityRole<Guid>>().ToTable("roles");
builder.Entity<IdentityUserRole<Guid>>().ToTable("user_roles");
builder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
builder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
builder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");
builder.Entity<IdentityRoleClaim<Guid>>().ToTable("role_claims");

// AppDbContext.OnConfiguring
optionsBuilder.UseSnakeCaseNamingConvention();
```

### NuGet packages to add (Track A, confirm in chat before installing)
- `EFCore.NamingConventions` — snake_case column names
- `Konscious.Security.Cryptography.Argon2` — Argon2id password hashing
- `Serilog.AspNetCore` + `Serilog.Sinks.Console`

### npm packages to add (Track B, confirm in chat before installing)
- `msw` — mock service worker
- `@microsoft/signalr` — SignalR client

### Idempotency key flow (Track A + Track B contract)
- Track B: `const idempotencyKey = crypto.randomUUID()` generated once per logical message, stored in component state. Never regenerated on retry.
- Track B coordination: `useSendMessage` owns the pending-sends map (keyed by `idempotencyKey`). The `onreconnected` handler only resubmits messages whose mutation promise is still unresolved. TanStack Query retries and reconnect-resubmits must not both fire for the same key — either one wins, the other is a no-op. Without this the server receives two concurrent invokes for the same key (see Track A race below).
- Track A — race-safe insert (naive `AnyAsync` + `Add` is racy: two concurrent invokes with the same key both see "not found," both insert, second throws):
  ```csharp
  var msg = new Message {
      Id = dto.IdempotencyKey,
      RoomId = dto.RoomId,
      AuthorId = userId,
      Content = dto.Content,
      SentAt = DateTime.UtcNow,
      Watermark = await NextWatermark(dto.RoomId), // atomic UPDATE ... RETURNING
  };
  db.Messages.Add(msg);
  try {
      await db.SaveChangesAsync();
  } catch (DbUpdateException ex)
      when (ex.InnerException is Npgsql.PostgresException pg
            && pg.SqlState == PostgresErrorCodes.UniqueViolation) {
      // Concurrent duplicate lost the race. Fetch the winner and return it.
      msg = await db.Messages.AsNoTracking().FirstAsync(m => m.Id == dto.IdempotencyKey);
  }
  return msg;
  ```
  On the catch branch the incremented watermark is wasted — leaves a hole in the sequence. Acceptable: watermark monotonicity is preserved, pagination and `since=` still work correctly, only `count(messages)` ≠ `max(watermark)`.
- SignalR `onreconnected` callback in Track B re-sends pending messages using their original keys (subject to the coordination rule above).

### Session validation (Track A)
`OnValidatePrincipal` fires on every authenticated request. It must:
1. Extract the session ID claim from the principal.
2. Load the `AppSession` row from DB (use a scoped service via `context.HttpContext.RequestServices`).
3. Reject (`context.RejectPrincipal()`) if the row is missing or `is_revoked = true`.
4. Update `last_seen_at` on valid sessions.

Cache the rejection for ~30 s with a `ValidatedOn` claim to avoid a DB hit on every request.

### CSRF seeding flow (Track B)
`useMe` calls `GET /api/auth/me` on mount. The response sets `XSRF-TOKEN` cookie. All subsequent mutations in `lib/api.ts` read this cookie and inject `X-XSRF-TOKEN`. Call `useMe` before any mutation hook can fire — the protected route guard ensures this ordering.

### Hub auth (Track A)
```csharp
app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization();
```
`Context.User` is populated from the cookie automatically on the WebSocket handshake. No separate token exchange needed.

### Serilog + SignalR enrichment (Track A)
```csharp
// In ChatHub handlers:
using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
using (LogContext.PushProperty("UserId", Context.UserIdentifier))
{
    // handler body
}
```
