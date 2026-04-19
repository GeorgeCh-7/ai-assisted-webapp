# Feature Spec: Phase 3 — Real-Time Polish + XMPP Proof + Demo-Ready

## Goal

Close the three visible Phase 2 gaps — new rooms don't appear in catalog without refresh, new DM threads don't appear in sidebar, notifications drift from unresolved Bug 4 — by landing a **single app-level shared SignalR hub connection** as the foundation, then broadcasting two new events on top of it. Fix known Bug 1 (private rooms leaking into the catalog). Ship a polished demo against a written script. Budget permitting, add a minimal Jabber/XMPP presence via an embedded ejabberd server plus a one-way bridge into our chat. Federation, admin dashboard, and Phase 3 Playwright tests are **explicitly cut** at the 15-hour budget.

## User-visible Outcome

Two users in separate browser profiles see rooms, DMs, invitations, friend requests, and bans update live without refresh, regardless of which page each user is on. Private rooms no longer leak into the public catalog. A written demo script walks the full journey (auth → catalog → room chat → DMs → moderation → sessions) end-to-end in under 6 minutes with no live surprises. If XMPP lands: a Gajim client connects to an embedded ejabberd server, sends a message in an XMPP MUC, and the message appears in a bridged chat room in our app.

## Context

- Roadmap phase: [Phase 3](../roadmap.md#phase-3-jabber--polish-day-2-pm)
- Depends on: Phase 1 + Phase 2 merged to `main`.
- Budget: **15 wall-clock hours, single developer, single track.**
- Mode: no contracts-first split, no parallel worktrees. Phase 2's 13-slice dependency-ordered plan was the right shape at 12–15h; Phase 3's surface is small and tightly sequenced, so coordination overhead is the wrong trade.
- Priority tagging is **pre-committed** (unlike Phase 2's "no cuts, dependency order decides"). XMPP variance is high and agents have unfamiliar priors; hard P0/P1/P2 tags prevent sunk-cost escalation.

### Explicitly out of scope for Phase 3

- Server-to-server XMPP federation (any form — not ejabberd-to-ejabberd, not ejabberd-to-public XMPP server).
- Admin dashboard. Dashboard's brief value was federation stats; with federation cut, dashboard is cargo-cult.
- Phase 3 Playwright tests for the new hub events. Manual demo-script verification across two browser profiles is the safety net.
- Rate limiting, metrics, distributed tracing.
- Avatar / profile editing.
- Email delivery for password reset.

### Bug 4 hypothesis (verified in Slice 0 before the refactor lands)

`web/src/features/chat/useSignalR.ts:53-299` and `web/src/features/dms/useDmSignalR.ts:26-167` build their `HubConnection` inside component-scoped `useEffect` hooks keyed on `roomId` / `threadId`. Consequences:

1. On any non-room / non-DM page (`RoomCatalogPage`, `FriendsPage`, `SessionsPage`, `/invitations`), **no hub connection exists at all** — therefore no `user-{userId}` events (`FriendRequestReceived`, `RoomInvitationReceived`, `UserBanned`, etc.) can arrive.
2. Switching rooms tears the connection down; during the gap, events are lost.
3. Even inside a room, the user-scoped event handlers are registered on a connection whose lifetime is coupled to that room.

The architectural fix is a single app-level shared `HubConnection` mounted in `App.tsx`, with per-room / per-DM hooks invoking `JoinRoom` / `JoinDm` against it rather than building their own. Slice 1 delivers this. Slice 0 is the 15-minute sanity check before committing to Slice 1.

---

## Dependency-ordered slice list with priority tags

Single-track, sequential. Each slice unblocks the next.

### Slice 0 — SignalR diagnostic gate (P0, 15 min, hard cap 30 min)

**Goal:** verify the Bug 4 hypothesis against running code before spending 2–4h on Slice 1. If the hypothesis is wrong, Slice 1 solves a non-problem.

**Steps:**
1. `docker compose up --build`. Log in as user A (profile 1) and user B (profile 2, incognito).
2. A opens room X. DevTools → Network → WS → filter `hubs/chat`. Confirm frames flow (e.g., a test message from B shows `MessageReceived` frame).
3. A navigates to `/friends` (no room open). B sends A a friend request. **Expected:** no `FriendRequestReceived` frame arrives at A within 5 s. The WebSocket is closed, not idle.
4. A navigates back into room X. B sends again — **expected:** frame arrives within 2 s.

**Gate outcomes:**
- Steps 3 + 4 match expectations → hypothesis confirmed, proceed to Slice 1.
- Step 3 shows the frame **does** arrive despite the page switch → hypothesis wrong. Stop. Do not continue with Slice 1. Re-diagnose (candidates: query-key mismatch, stale-closure captures in handlers, invalidation not triggering re-render). **Escalate to user at 30 min total** — do not burn more.

### Slice 1 — Shared app-level hub connection (P0, 2–4h)

**Goal:** move from per-component hub connections to a single hub connection that lives for the authenticated session.

**New:**
```
web/src/lib/hub.ts                            -- singleton HubConnection factory + state machine
web/src/features/chat/HubProvider.tsx         -- mounts the shared connection at App root
web/src/features/chat/useHub.ts               -- returns { hub, connectionState } from context
web/src/features/chat/useGlobalHubEvents.ts   -- subscribes user-{userId} events (friends, invitations, bans) — runs once at App root regardless of page
```

**Modified:**
```
web/src/App.tsx                               -- wraps protected routes in <HubProvider>
web/src/features/chat/useSignalR.ts           -- consume shared hub; only handle room-scoped events; keep JoinRoom/LeaveRoom + gap recovery
web/src/features/dms/useDmSignalR.ts          -- consume shared hub; only handle dm-{threadId}-scoped events; keep JoinDm/LeaveDm
```

**Behavioral contract:**
- `HubProvider` starts the connection on mount (after `useMe` resolves), stops on logout / unmount.
- Auto-reconnect unchanged (`withAutomaticReconnect([0, 2000, 5000, 10000, 30000])`).
- `useGlobalHubEvents` handles every `user-{userId}` event: `FriendRequestReceived`, `FriendRequestAccepted`, `FriendRequestDeclined`, `FriendRemoved`, `UserBanned`, `RoomInvitationReceived`, `RoomBanned`. Each handler invalidates the relevant React Query key.
- `useSignalR(roomId)` no longer owns the connection; it calls `JoinRoom({ roomId })` on the shared hub on mount, `LeaveRoom` on unmount. Handlers for room-scoped events (`MessageReceived`, `MessageEdited`, `MessageDeleted`, `PresenceChanged`, `RoomDeleted`, `RoleChanged`, `UserJoinedRoom`, `UserLeftRoom`) are registered per-mount and un-registered on unmount.
- `useDmSignalR(threadId)` mirrors the room pattern for DM-scoped events.

**Verification (inside Slice 1, before moving on):**

*Automated — non-negotiable:*
- Run `npm run test:e2e` (the root-level Playwright suite covering Phase 1 `dedup.spec.ts` and Phase 2's six specs). **Any regression = Slice 1 is not done — keep working.** The refactor must preserve every existing tested behavior; a green baseline before + red after means the refactor broke something. Diagnose and fix before declaring Slice 1 complete.

*Manual — the React strict-mode + shared-context bug class this refactor is prone to:*
1. **User-scoped events reach non-room pages.** Friend request to A sent while A is on `/friends` updates the list within 2 s without navigation. Room invitation to A sent while A is on `/rooms` (catalog) updates the invitation badge within 2 s.
2. **Cross-room navigation preserves message integrity.** In room X send 5 messages; close the room (navigate away); open room Y and send 5 messages; return to room X and send 5 more. Verify: no duplicate messages, no missing messages in either room, no duplicated `UserJoinedRoom` / `UserLeftRoom` / `PresenceChanged` events (check React Query cache or DevTools console — double-fire indicates a handler was registered twice).
3. **Rapid DM delivery with the thread open.** Open a DM thread to B. From a second profile as B, send 10 messages rapidly (e.g., a loop of `SendDirectMessage` over 3 s). Verify all 10 arrive in order on A's side with no gaps and no duplicates. Gaps point at gap-recovery not running; duplicates point at handler double-registration (the textbook React strict-mode double-mount failure).
4. **Notifications between navigation.** Opening, closing, and re-opening a room does not drop friend-request or invitation notifications arriving during the transition window.

### Slice 2 — Bug 1 fix: private rooms leak into catalog (P0, 0.5–1h)

**Goal:** eliminate the UI-level leak where user C (non-member of any private room) sees private rooms in the public catalog despite correct server + MSW filtering.

**Investigation first:** the backend filter at `api/Features/Rooms/RoomsEndpoints.cs:39-42` and the MSW filter at `web/src/mocks/handlers.ts:613-624` are both verified correct. The leak is UI-level. Candidate causes:
- Separate queries for "public" and "private" sections of the catalog, with the private query bypassing the visibility filter client-side.
- A `useRooms()` hook that overfetches via a query that doesn't pass the filter param.
- Stale optimistic data in the query cache after room creation.

**Fix cap:** if the cause isn't located in 30 min, mark Bug 1 deferred in `docs/known-bugs.md` and move on to Slice 3. Do not let Bug 1 eat into real-time work.

### Slice 3 — Real-time catalog updates (P0, 1–2h)

**Goal:** a room created in profile A appears in profile B's catalog within 2 s without refresh. Deleted public rooms disappear from all viewers' catalogs.

**Backend changes (`api/Hubs/ChatHub.cs`, `api/Features/Rooms/RoomsEndpoints.cs`):**
- `OnConnectedAsync` auto-joins the new group `public-rooms-catalog` (in addition to the existing `user-{userId}` auto-join).
- `POST /api/rooms` — on success, if `isPrivate == false`, broadcast `RoomCreated` to `public-rooms-catalog` with the room DTO shape matching the catalog row (`id`, `name`, `description`, `memberCount`, `isMember: false`, `isPrivate: false`, `myRole: null`).
- `DELETE /api/rooms/{id}` — extend the existing `RoomDeleted` fanout. Currently broadcast to `room-{id}` only (Phase 2); now also broadcast to `public-rooms-catalog` when the deleted room was public. Order: broadcast → save-changes (same ordering rule as Phase 2's `RoomDeleted` to `room-{id}`).

**Frontend changes:**
- `useGlobalHubEvents.ts` subscribes to `RoomCreated` and `RoomDeleted`; invalidates `['rooms']` query key on both.
- `web/src/mocks/handlers.ts` + `web/src/mocks/signalr.ts` emit the same events against MSW (**per the MSW parity clause in contracts.md**).

**Verification:** open two profiles on `/rooms`. Profile A creates a public room. Profile B sees it appear within 2 s. Profile A deletes it. Profile B sees it disappear within 2 s.

### Slice 4 — Real-time DM sidebar (P0, 1–2h)

**Goal:** A opens a DM thread to B (first-time), B's sidebar shows the new thread within 2 s without refresh.

**Backend changes (`api/Features/Dms/DmEndpoints.cs`, `api/Features/Dms/DmService.cs`):**
- `POST /api/dms/open` — when the thread is **newly created** (not already existed), broadcast `DmThreadCreated` to both `user-{userA}` and `user-{userB}`. If thread already existed, do not broadcast.
- Payload: the thread DTO from `DmThreadDto` — `id`, `otherUser` (shaped for the recipient, so per-recipient payload), `lastMessagePreview: null`, `lastActivityAt`, `unreadCount: 0`, `frozenAt: null`, `otherPartyDeletedAt: null`.

**Race-safe "newly-created" signal (non-negotiable):** The boolean that decides whether to broadcast MUST derive from the `INSERT … ON CONFLICT DO NOTHING RETURNING id` result — specifically, whether the statement returned a row (inserted) vs. returned zero rows (conflict swallowed). Do **not** gate the broadcast on a pre-check like `await db.DmThreads.AnyAsync(...)` followed by an `Add`/`SaveChangesAsync`. The pre-check + insert pattern is racy: two users opening a DM to each other at the same instant both see "not exists" in their pre-check, both try to insert, one wins and one catches a unique-constraint violation — and a naive `AnyAsync` guard would broadcast twice on the happy path (both callers believed they created it) or zero times on some ordering paths. The correct pattern matches Phase 1's message idempotency flow (see `docs/features/phase-1-spec.md` — "Idempotency key flow"): catch `DbUpdateException` where inner `PostgresException.SqlState == UniqueViolation`, re-fetch the winning row, and return a `(thread, wasNewlyCreated)` tuple. Only the `wasNewlyCreated == true` path broadcasts. Exactly one broadcast per actual creation — the DB decides the winner, not application-layer timing.

**Frontend changes:**
- `useGlobalHubEvents.ts` subscribes to `DmThreadCreated`; invalidates `['dms']` query key.
- MSW handler + signalr emitter updated to match.

**Verification:** A opens a DM to B (first time). B's sidebar (visible on any page) updates within 2 s.

### Slice 5 — UI polish pass (P0, 2–3h)

**Goal:** demo path visibly production-grade. Not: every screen polished; not: edge cases in rarely-visited flows.

**Scope (in demo-script-visible order):**
1. Login → register forms — error display, loading states, field alignment.
2. Catalog — empty state, search clearing, private-room badge, live-update animation (subtle).
3. Room chat — message spacing, author name typography, edited/deleted visual parity, reply-quote visual clarity, composer disabled state.
4. Moderation modal — tab focus states, confirmation dialogs on destructive actions (ban, delete room).
5. Friends page — request incoming/outgoing visual distinction, empty state.
6. DM sidebar + window — unread badge, frozen banner clarity.
7. Sessions page — current-session marker, confirm-revoke dialog.
8. `console.log` / `console.warn` cleanup across `web/src/features/**` (except intentional `console.error` in catch blocks — keep those).

**Hard cap:** 3h. Strict triage. If screen N is still rough at cap, note in `docs/known-bugs.md` and move on.

### Slice 6 — Demo script (P0, 1–2h)

**Goal:** a written walkthrough that the developer can rehearse and hit in under 6 minutes with no live surprises.

Produce `docs/demo-script.md` with the skeleton in this repo (already created). Fill in narration, test each step manually, mark any steps that flake. If a step flakes, either fix it or drop it from the script — do not demo it.

### Slice 7 — XMPP (P2, budget-gated stretch, 6–8h with fallback ladder)

**Budget gate (hard, three tiers measured at Slice 7 start — after Slice 6 lands and the demo script is rehearsed):**

| Remaining hours | Entry point | Rationale |
|---|---|---|
| **≥ 6 h** | Target **(d)** — embedded ejabberd + minimal one-way bridge into our chat. Fallback ladder (d → c → b → a) applies mid-slice if the bridge fights back. | Full bridge is demoable; fallback safety net absorbs variance. |
| **3 – 6 h** | Start directly at **(c)** — ejabberd + two Gajim clients, no bridge attempt. | Bridge work is 3–5 h on its own; starting (d) with < 6 h remaining reliably ships a half-built bridge. Entering at (c) is brief-literal, demoable, and leaves time for rehearsal. |
| **< 3 h** | Fall back to **(b)** design doc, or **(a)** full cut. | Even ejabberd standalone is ~2 h of docker-compose + config fighting. Under 3 h, writing `docs/xmpp-design.md` (1 h) and honestly pitching "designed, not built" beats a broken live demo. |

The tier is decided **once**, at Slice 7 start, and does not downgrade based on optimism mid-slice. The (d → c → b → a) fallback ladder described below only applies when the starting tier was **(d)** — it's the mid-slice safety net for the highest-effort path, not a general escalator.

**Target form (option d from interview):** embedded ejabberd in docker-compose with a minimal one-way bridge into our chat.

**Scope:**
1. Add `ejabberd` (or Prosody — pick whichever has more batteries-included docker image; ejabberd's official image is `ejabberd/ecs`) as a new service in `docker-compose.yml`. Hardcode two test accounts (`gajim-user-a@chat.local`, `gajim-user-b@chat.local`) via ejabberd config.
2. Configure one XMPP MUC (multi-user chat) room: `bridge@conference.chat.local`.
3. Build a bridge in .NET (or sidecar Node — whichever integrates faster with an XMPP library): subscribe to MUC messages via an XMPP client library, mirror each message into one of our existing chat rooms (hardcode the target room ID in config for demo).
4. Bridge direction is **one-way** (XMPP → our app) for Slice 7 P2. Reverse direction (our app → XMPP) is deferred; if time remains beyond Slice 7, add as an unscheduled stretch.
5. Frontend: add a small "via Jabber" badge on messages whose `authorUsername` matches a bridge-sourced prefix (e.g. `xmpp:gajim-user-a`).

**Library guesses (weak priors, verify at start of Slice 7):** XmppDotNet for .NET client; `@xmpp/client` (npm) for Node. The user said XMPP is unfamiliar territory — if the chosen library doesn't yield a working MUC subscribe in 2h, that is the bridge's fallback signal (see below), not a debugging rabbit hole.

**Fallback ladder during Slice 7:**
- **(d)** Bridge working bidirectionally → ship.
- **(d-minus)** Bridge working one-way (XMPP → app) → ship; note "reverse direction deferred" in demo script.
- **(c)** Bridge fails or XMPP library fights you → at elapsed +5h on Slice 7, cut the bridge. Keep the ejabberd service. Demo shows Gajim connecting to ejabberd, two Gajim clients chatting. Separate from our app — brief-literal satisfaction of the Jabber requirement.
- **(b)** ejabberd docker service itself isn't usable → at elapsed +6h on Slice 7, cut all code. Write `docs/xmpp-design.md` describing the bridge architecture we would have built. Demoed as "designed, not built." Honest.
- **(a)** XMPP cut entirely. Update `roadmap.md` to note Phase 3 did not deliver Jabber.

Each fall-back step is one-way: once you drop from (d) to (c), do not attempt to climb back to (d).

---

## Files to Create / Modify (consolidated)

### Backend

**New:**
```
(none — all Phase 3 additions modify existing hubs/endpoints)
```

**Modified:**
```
api/Hubs/ChatHub.cs                           -- OnConnectedAsync auto-joins public-rooms-catalog; RoomCreated / RoomDeleted-fanout / DmThreadCreated broadcasts
api/Features/Rooms/RoomsEndpoints.cs          -- broadcast RoomCreated on POST; extend RoomDeleted fanout
api/Features/Dms/DmEndpoints.cs               -- broadcast DmThreadCreated on first-time thread creation
api/Features/Dms/DmService.cs                 -- return "newly-created" signal from lazy thread creation so endpoint can conditionally broadcast
```

**Slice 7 additions (budget-gated):**
```
docker-compose.yml                            -- add ejabberd service + hardcoded accounts/MUC
api/Features/XmppBridge/XmppBridgeService.cs  -- BackgroundService, subscribes MUC, mirrors into Messages table
api/Features/XmppBridge/XmppConfig.cs         -- ejabberd connection + bridge room id config
```

### Frontend

**New:**
```
web/src/lib/hub.ts                            -- singleton HubConnection factory
web/src/features/chat/HubProvider.tsx         -- mounts at App root
web/src/features/chat/useHub.ts               -- context consumer
web/src/features/chat/useGlobalHubEvents.ts   -- user-{userId} + public-rooms-catalog event handlers
```

**Modified:**
```
web/src/App.tsx                               -- wrap protected routes in HubProvider
web/src/features/chat/useSignalR.ts           -- consume shared hub; remove self-built connection; keep room-scoped event handlers only
web/src/features/dms/useDmSignalR.ts          -- mirror of above for DM scope
web/src/features/rooms/useRooms.ts            -- (no behavior change; query invalidations come from global hub events)
web/src/features/dms/useDms.ts                -- same
web/src/mocks/handlers.ts                     -- add RoomCreated / DmThreadCreated / RoomDeleted-fanout emission; honor MSW parity clause
web/src/mocks/signalr.ts                      -- same
(visual polish pass — Slice 5 — touches many components across features; not enumerated)
```

### Docs

**New:**
```
docs/demo-script.md
```

**Modified:**
```
docs/contracts.md                             -- append "API Contracts — Phase 3" section
docs/known-bugs.md                            -- mark Bug 2 + Bug 3 resolved as slices 3/4 land; mark Bug 4 resolved as slice 1 lands; add any Slice 2 or Slice 5 carryovers
docs/roadmap.md                               -- update Phase 3 Deliverables to reflect actual shipped scope vs. original "federation + dashboard" brief
```

---

## Scorecard

- [ ] **Slice 0 completes in under 30 min with a clear go/no-go.** DevTools-observed behavior documented in `docs/known-bugs.md` Bug 4 section. If no-go, escalation to user happens before Slice 1 starts.

- [ ] **Slice 1 verified without refresh.** Two browser profiles. User A on `/friends`; user B sends a request from `/rooms`. A's request list updates within 2 s. User A opens a room; user B invites A to a different (private) room. A's invitation badge updates within 2 s without A leaving the current room.

- [ ] **Slice 2 resolved or explicitly deferred.** If fixed, private-room catalog leak no longer reproducible as described in `docs/known-bugs.md` Bug 1. If deferred, Bug 1 has a new entry describing what was tried and why the hypothesis search stopped.

- [ ] **Real-time catalog works across two profiles.** Profile A creates a public room → profile B's catalog updates within 2 s. Profile A deletes it → profile B sees it disappear within 2 s. No refresh.

- [ ] **Real-time DM sidebar works across two profiles.** User A opens a first-time DM to B → B's sidebar updates within 2 s without refresh. Repeat `POST /api/dms/open` when the thread already exists does **not** re-broadcast.

- [ ] **Demo script runs end-to-end in ≤ 6 min.** Manually timed. Every step in `docs/demo-script.md` executes without a live surprise; any flaky step is either fixed or removed from the script before the demo.

- [ ] **MSW parity clause honored.** Every handler added or touched in Phase 3 implements the same conditional logic as the real backend (not just the DTO shape). Verified by running the app with `VITE_MSW_ENABLED=true` and repeating the demo script — observable behavior is indistinguishable from the real backend.

- [ ] **(P2, conditional) XMPP reaches at least fallback (c).** Gajim connects to embedded ejabberd and exchanges messages with another Gajim client, even if the bridge never worked. If fallback is (b) or (a), record in `docs/xmpp-design.md` or `docs/roadmap.md` respectively.

---

## Out of Scope

- Bidirectional XMPP federation; XMPP-to-public-server (e.g., to `jabber.org`).
- Admin dashboard (cut alongside federation).
- Phase 3 automated tests — manual demo script verification is the safety net for Phase 3 features. Phases 1 and 2 xUnit + Playwright tests continue to run unchanged.
- Avatar upload, profile editing.
- Email delivery, SMS, push notifications.
- Rate limiting, per-user quota, metrics dashboards, distributed tracing.

---

## Notes

### What gets dropped if a slice takes 2× expected time

Order, highest-priority-to-keep first:

1. **Slice 7 (XMPP)** drops first and hardest via its own fallback ladder (d → c → b → a). This is by design — XMPP is the slice explicitly chosen to be variance-absorbing.
2. **Slice 5 (polish)** shrinks next. Hard triage to the 3-4 most demo-visible screens (login, catalog, room chat, DM window) and cut visual work on sessions / password-reset / moderation-modal tabs. Don't demo what isn't polished.
3. **Slice 2 (Bug 1)** defers to `known-bugs.md` if investigation exceeds 30 min. Private-room leak is a judges-will-notice bug but not demo-breaking if the script doesn't touch the catalog from a non-member's view.
4. **Slice 4 (DM real-time sidebar)** drops before Slice 3 (catalog) if real-time work slips. DM sidebar has lower demo visibility than catalog updates; catalog live-update is a more impressive demo beat.
5. **Slice 3 (catalog real-time)** drops only if Slice 1 itself slips catastrophically — in which case the entire real-time story collapses and the demo falls back to showing Phase 2's existing feature set with a manual refresh.
6. **Slice 1 (shared hub refactor) and Slice 6 (demo script)** are non-negotiable. If Slice 1 cannot land in 4h, stop and escalate — the Phase 3 thesis is broken.

### Why single-track at 15h

Phase 1 and 2's parallel-track structure paid off at 12–15h each because surface was large and split cleanly between backend (schema + endpoints) and frontend (pages + MSW). Phase 3's surface is small, mostly frontend-weighted (shared hub refactor is ~90% frontend), and sequentially dependent (Slice 1 blocks Slice 3 and Slice 4). Parallel tracks would spend their first hour on MSW skeleton coordination and contracts lock, then find they have nothing independent to build in parallel. Single-track sequential is ~2–3h cheaper in coordination tax.

### Why no Phase 3 Playwright tests

Phase 1's `e2e/tests/dedup.spec.ts` and Phase 2's six Playwright tests verify auth, private rooms, message permissions, friends/DMs/ban, file access, sessions, and presence. Phase 3's new surface is (a) one architectural refactor that is verified by the existing tests not regressing, and (b) three new hub events that are verified by the demo script walk-through. Writing 2–3h of new Playwright for three thin events trades 2–3h of polish for near-zero demo-value delta.

### Fallback on Slice 1 if the refactor grows

If Slice 1 exceeds 4h and isn't converging, the root cause is likely HubConnection lifecycle interacting badly with React strict-mode double-mounts or with `useEffect` cleanup ordering. Named escape hatch: keep the shared connection in a module-level singleton (outside React) with explicit `acquire()` / `release()` semantics, instead of context. Ugly but robust.

### Slice 7 XMPP library priors (honest — weak)

- **XmppDotNet** is the most-linked .NET XMPP client library but has thin docs. API surface for MUC subscribe is ~20 lines if it works; unknown-unknown if the TLS negotiation with ejabberd's docker image needs tuning.
- **Writing an XMPP server from scratch in .NET is multi-day work.** This is why (d) uses ejabberd (a real server) as the XMPP side, and our .NET code is only a client.
- **ejabberd's docker image** is well-maintained; configuration via `ejabberd.yml` is the standard friction. Expect 30–60 min to get auth + MUC working at all. Do not attempt TLS for the demo — plaintext inside docker network is acceptable for the hackathon.
- **If XmppDotNet's MUC subscribe isn't yielding messages after 2 h**, the bridge is not going to ship. Fall back to (c) at that moment without further debugging.
