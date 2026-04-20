# Chat

A real-time web chat application with rooms, direct messages, file sharing, presence, and XMPP federation.

## Introduction

A full-stack chat application in the style of classic web chat clients: a top navigation bar, a center message area with a composer at the bottom, and a right-hand sidebar holding rooms and contacts. Users register, join or create public and private rooms, exchange real-time messages with reply/edit/delete, build a friends list, and open one-to-one DMs with their contacts. Files and images can be attached by button or paste, and a presence indicator reflects online / AFK / offline state across every tab a user has open.

The backend is a .NET 9 Minimal API backed by PostgreSQL and EF Core, with SignalR for real-time push. The frontend is a React 18 + TypeScript + Vite single-page app that talks to the backend over cookie-authenticated REST and a shared SignalR hub connection. The whole system runs under Docker Compose, including an embedded ejabberd XMPP server that is bridged bidirectionally into the app's general room — a second ejabberd instance runs alongside to demonstrate XMPP S2S federation within the same deployment.

The app is designed to stay usable at the shape of a typical community: hundreds of concurrent connections, thousands of messages per room, and rooms with up to ~1,000 members.

## Features

### Authentication & sessions
- Argon2id password hashing via `Konscious.Security.Cryptography.Argon2`, registered as a custom `IPasswordHasher<AppUser>` over Identity's default.
- Cookie-based session auth using ASP.NET Core Identity (`.chat.session` cookie, HttpOnly, SameSite=Lax).
- CSRF protection with the request-token pattern — JS-readable `XSRF-TOKEN` cookie echoed as `X-XSRF-TOKEN` header on every mutation.
- Active sessions list: browser/IP captured at login, per-session revocation from the UI.
- Password change and password reset (on-screen token flow — email delivery not wired).
- Account deletion with documented cascade rules (see Architecture).
- "Keep me signed in" toggle at login — session-cookie vs persistent-cookie behavior.

### Rooms & moderation
- Public rooms with discoverable catalog and search (keyset pagination, not OFFSET).
- Private rooms — invite-only, excluded from the public catalog.
- Invitation flow for private rooms.
- Owner / admin / member roles; owner cannot leave; admins manage members.
- Ban and unban with `banned_by` and `banned_at` recorded; banned-users tab in the moderation modal.
- Room settings and room deletion by owner.

### Messaging
- Real-time delivery via SignalR (`/hubs/chat`).
- Idempotent sends — client-generated keys deduplicated race-safely on insert.
- Reply / quote to a specific message.
- Edit with an "edited" indicator; soft-delete by author or room admin.
- 3 KB UTF-8 content limit, enforced server-side.
- Cursor-based infinite scroll over watermark-ordered messages; stable at 10,000+ messages per room.
- Per-room unread counts, updated in real time via SignalR push to member user groups, cleared on open.

### Direct messages
- Friends-gated one-to-one threads; existing threads remain readable after a ban.
- Full message feature parity with rooms — reply, edit, delete, attachments.
- User-to-user block freezes the thread as read-only; prior history preserved.
- Per-thread unread counts, updated in real time via `DmUnreadUpdated` push to the recipient.

### Friends & contacts
- Request / accept / decline by username or from a room member list.
- Remove friend; user-to-user block list.
- Friendship rows stored canonically (lower `user_id_a`, higher `user_id_b`) to prevent duplicates.

### Files & images
- Upload via button or paste into the composer.
- Inline rendering for images; original filename preserved for downloads.
- Access-controlled: only current room members / DM participants can fetch the file.
- 20 MB file limit, 3 MB image limit; local filesystem storage.
- Orphan sweeper reclaims files whose host message was never persisted.

### Presence
- `online` / `afk` / `offline` states.
- Multi-tab coordination via connection ref-counting in the hub.
- Sub-2s propagation through SignalR fanout.
- AFK transition after 60 s of heartbeat silence; any heartbeat reverts to online.

### Avatars
- DiceBear `initials` SVG default.
- Custom avatar upload per user, stored on the local filesystem; served from `GET /api/users/{id}/avatar`.
- Message bubbles fall back: custom → DiceBear → colored-letter circle.

### XMPP integration
- Embedded ejabberd server reachable on `localhost:5222`.
- `XmppBridgeService` background service connects as `bridge-bot@chat.local`, joins `bridge@conference.chat.local`, and mirrors messages bidirectionally into the app's general room. XMPP-originated messages carry a "via Jabber" badge.
- Second ejabberd instance (`fed.local`, exposed on `localhost:5223`) wired for XMPP S2S federation with dialback so `gajim-user-fed@fed.local` can join the same MUC.

## Tech stack

### Backend
- **.NET 9** Minimal API (no controllers)
- **ASP.NET Core Identity** with cookie auth (`Microsoft.AspNetCore.Identity.EntityFrameworkCore` 9.0.0)
- **Argon2id** password hashing — `Konscious.Security.Cryptography.Argon2` 1.3.1
- **EF Core 9** with `Npgsql.EntityFrameworkCore.PostgreSQL` 9.0.2 and `EFCore.NamingConventions` 9.0.0 (snake_case)
- **PostgreSQL 16** (Alpine)
- **SignalR** (bundled with ASP.NET Core 9)
- **Serilog** 9.0.0 — structured JSON logs with SignalR connection ID enriched
- **Swashbuckle** 7.2.0 for OpenAPI / Swagger UI
- **xUnit** for integration and unit tests (via `WebApplicationFactory`)

### Frontend
- **React 18.3** + **TypeScript 5.6** + **Vite 5.4**
- **Tailwind CSS 3.4** with **shadcn/ui** (Radix primitives: dialog, dropdown-menu, select, tabs, toast, etc.)
- **TanStack Query 5.99** for server state
- **React Router 7** for routing
- **@microsoft/signalr 10** client
- **react-hook-form 7** + **zod 4** for complex forms
- **MSW 2.13** (Mock Service Worker) for frontend-only development and testing
- **lucide-react** icons

### Infrastructure
- **Docker Compose** orchestration
- **ejabberd** (latest, ghcr.io/processone/ejabberd) — two instances for S2S federation
- **Playwright 1.50** for end-to-end tests

## Architecture

**SignalR hub topology.** A single app-level hub connection is established at the React root. The hub subscribes each connection to per-room (`room-{roomId}`), per-DM (`dm-{threadId}`), per-user (`user-{userId}`), and catalog (`public-rooms-catalog`) groups. This keeps user-scoped events flowing regardless of which page is open, and lets the catalog receive room-create/delete fanout in real time.

**Message idempotency.** Every send carries a client-generated idempotency key. The server writes with `ON CONFLICT DO NOTHING` and catches unique-violation races to stay correct under concurrent duplicate sends. SignalR reconnect retries therefore never produce duplicate messages.

**Cursor pagination.** Message history uses keyset pagination over a monotonic per-room `watermark` column — not OFFSET/LIMIT. Stable at 10k+ messages per room; the room catalog uses keyset pagination over `(name ASC, id ASC)` with an opaque base64 cursor.

**Session cookie auth with CSRF.** ASP.NET Core antiforgery in request-token mode: the framework manages its encrypted cookie-token, and `/api/auth/me` writes the accompanying request token into a JS-readable `XSRF-TOKEN` cookie. The frontend fetch wrapper reads that cookie and echoes it as `X-XSRF-TOKEN` on every mutation.

**Session management.** A `sessions` table records browser/IP captured at login. `OnValidatePrincipal` checks the session row on each authenticated request with a 30s cache, so revoking a session from another device invalidates the cookie within that window.

**Cascade semantics for account deletion.** Owned rooms, memberships, friendships, and sessions cascade. `messages.author_id` and `file_attachments.uploader_id` are `SET NULL` so other users' rooms retain readable history. DM thread participants use `RESTRICT` with an explicit handler that marks threads with `other_party_deleted_at` instead of deleting them, preserving both sides' view.

**XMPP bridge.** `XmppBridgeService` runs as a `BackgroundService`, logs in to ejabberd as `bridge-bot@chat.local`, joins `bridge@conference.chat.local`, and shuttles messages between the MUC and the app's general room in both directions. Messages originating from XMPP are persisted with a flag the frontend renders as a "via Jabber" badge.

**Frontend mock backend.** MSW handlers mirror every REST endpoint and a simulated SignalR surface, so the frontend boots and every feature path is usable without the backend running. The Playwright suite optionally targets either the mock or the real API.

## Getting started

### Prerequisites
- Docker and Docker Compose
- Node 20+ (only if developing the frontend outside Docker)

### Run everything
```bash
git clone <repo-url>
cd ai-assisted-webapp
docker compose up --build
```

First startup takes ~60 s (NuGet restore + npm install + ejabberd warm-up). Subsequent starts are ~10 s.

### Service URLs

| Service               | URL / Host                | Notes                                            |
|-----------------------|---------------------------|--------------------------------------------------|
| Web                   | http://localhost:5173     | Vite dev server                                  |
| API                   | http://localhost:5080     | Redirects `/` → `/swagger`                       |
| Swagger               | http://localhost:5080/swagger | OpenAPI explorer                             |
| Health                | http://localhost:5080/health  |                                              |
| PostgreSQL            | localhost:5432            | user `app`, password `app`, db `appdb`           |
| ejabberd (primary)    | localhost:5222 (XMPP c2s), 5269 (s2s), 5280 (HTTP) | `chat.local`                |
| ejabberd (federation) | localhost:5223 (XMPP c2s), 5270 (s2s) | `fed.local`                          |

Register a user at http://localhost:5173 and start chatting.

### Test XMPP
Connect any XMPP client (Gajim, Dino) with:

| Account              | Host       | Port  | Password    |
|----------------------|------------|-------|-------------|
| `gajim-user-a`       | `chat.local` | 5222 | `Test123!`  |
| `gajim-user-b`       | `chat.local` | 5222 | `Test123!`  |
| `gajim-user-fed`     | `fed.local`  | 5223 | `Test123!`  |

Join `bridge@conference.chat.local` to see messages flow to and from the app's general room.

## Development

### Frontend
```bash
cd web
npm install
npm run dev                      # hits Docker backend on :5080
VITE_MSW_ENABLED=true npm run dev  # fully-mocked, no backend required
```

### Backend
The Docker workflow is the simplest path; `dotnet watch` runs inside the container with the source directory volume-mounted, so edits to `.cs` files hot-reload automatically. If you want to run the API directly on the host:

```bash
cd api
dotnet run
```
This still requires a reachable PostgreSQL — point `ConnectionStrings__Default` at your instance.

### Database schema
The project uses `db.Database.EnsureCreated()` at startup — there are no migrations. Schema changes require a clean rebuild:
```bash
docker compose down -v && docker compose up --build
```

### Environment variables
Key variables (see `docker-compose.yml` for the full list):

| Variable | Used by | Purpose |
|----------|---------|---------|
| `ConnectionStrings__Default` | api | Postgres connection string |
| `ASPNETCORE_ENVIRONMENT` | api | `Development` enables Swagger + dev CORS |
| `ASPNETCORE_URLS` | api | HTTP bind address |
| `DOTNET_USE_POLLING_FILE_WATCHER` | api | Required for hot reload across Docker volumes |
| `VITE_API_URL` | web | Base URL the frontend targets |
| `VITE_MSW_ENABLED` | web | Switch frontend to mocked backend |
| `VITE_SHOW_DEVTOOLS` | web | Set to `true` to show TanStack Query devtools (hidden by default) |

## Testing

### Backend (xUnit)
```bash
cd api.Tests
dotnet test
```
Covers: auth flows, message deduplication (including race-safe concurrent-key path), 3 KB content validation, cursor pagination, room membership rules (owner-cannot-leave), file access control, account-deletion cascades, DM rules, and SignalR hub integration via `WebApplicationFactory`.

### End-to-end (Playwright)
```bash
cd e2e
npm install
npm run install-browsers
npm test
```
Specs cover private rooms and moderation, message permissions, friends/DMs/bans, file access control, session management, presence across tabs, idempotency under simulated network races, and real-time notifications across multiple browser contexts.

Playwright tests run against a live stack — start `docker compose up` before `npm test`.

## Project structure

```
api/                      .NET backend (Minimal API)
  Domain/                 EF Core entities (POCOs)
  Features/               Feature folders: Auth, Rooms, Messages, Dms,
                          Friends, Files, Presence, XmppBridge
  Hubs/                   ChatHub (SignalR)
  Infrastructure/         Argon2PasswordHasher, sweepers, filters
  Data/                   AppDbContext
  Program.cs              Startup + route wiring

api.Tests/                xUnit integration + unit tests

web/                      React + Vite frontend
  src/
    features/             auth, chat, dms, files, friends, layout,
                          presence, profile, rooms, sessions
    components/ui/        shadcn/ui components (do not hand-edit)
    lib/                  api.ts, hub.ts, queryClient.ts, utils.ts
    mocks/                MSW handlers + simulated SignalR
    App.tsx, main.tsx

e2e/                      Playwright specs
  tests/                  dedup, file-access, friends-dms-ban,
                          message-permissions, presence, private-rooms,
                          sessions, ...

ejabberd/                 ejabberd.yml + federation config

docs/                     product.md, roadmap.md, contracts.md,
                          demo-script.md, tech.md

docker-compose.yml
```

## API reference

The full REST and SignalR contract — endpoints, payloads, error shapes, pagination rules, hub method and event surface — lives in `docs/contracts.md`. Endpoint categories:

- `auth` — register, login, logout, me, password change/reset, account deletion
- `rooms` — CRUD, catalog, membership, moderation, invitations
- `messages` — history, send, edit, delete (room + DM, via hub and REST)
- `dms` — thread list and thread creation
- `friends` — requests, accept/decline, remove, block
- `files` — upload and access-controlled download
- `sessions` — list and per-session revocation
- `users` — profile, avatar upload/fetch
- `presence` — heartbeat + state broadcast (SignalR)

OpenAPI UI available at http://localhost:5080/swagger while the API is running.

## Known limitations

The following are deferred by design.

- **Password reset delivery** — the reset endpoint produces a token shown on-screen for the user to paste into the change form. Email delivery is not wired.
- **Rate limiting** — no request throttling on auth, send, or file upload paths.
- **Virus scanning** — uploaded files are stored as-is; no ClamAV or similar scan pipeline.
- **CI/CD** — no automated build or deploy pipeline in the repo.
- **Email verification** — accounts are usable immediately after registration.
- **Production Dockerfiles** — the provided images target local development with source-mount hot reload.
- **Observability** — Serilog writes structured JSON to stdout; no metrics, tracing, or log sink beyond the console.

## License

License: TBD — no `LICENSE` file is present in the repository.
