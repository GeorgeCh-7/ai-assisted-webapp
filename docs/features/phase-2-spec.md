# Feature Spec: Phase 2 — Full Feature Set

## Goal

Deliver every remaining brief requirement — private rooms with invitations, room moderation, friends/contacts, DMs, message reply/edit/delete, file sharing, AFK presence, active sessions, password flows, account deletion — so the app satisfies the brief end-to-end before Jabber work begins in Phase 3.

## User-visible Outcome

A user logs in, creates or joins a **private** room via invitation, promotes another member to admin, bans a troublemaker. They send a friend request by username, confirm a friend back, and open a direct-message thread with full reply/quote/edit/delete parity. They paste an image into a room, the image renders inline and only members can view it. They go idle for a minute and their presence flips to AFK automatically; another tab keeps them online. They open the Sessions page, see their laptop and phone listed with browser/IP, and log out the phone. They change their password. They delete their account, and their rooms vanish while their DM history with friends stays read-only.

## Context

- Roadmap phase: [Phase 2](../roadmap.md#phase-2-full-feature-set-day-1-pm--day-2-am)
- Depends on: Phase 1 (auth, public rooms, `ChatHub`, presence ref-count, cursor pagination, `EnsureCreated` schema)
- Architecture decisions locked in interview (2026-04-19):
  1. **DM data model:** separate `dm_threads` + `dm_messages` tables (not unified with rooms). Own watermark namespace per thread. Duplicated message-feature surface (reply/edit/delete/file attach) is the accepted cost for isolation and a natural home for `dm_threads.frozen_at`.
  2. **Friends:** single normalized row, `friendships(user_a_id, user_b_id, …)` with DB-enforced `user_a_id < user_b_id`. Direction stored in `requested_by_id`. Ban is a separate asymmetric table `user_bans(banner_id, banned_id)` acting as a veto overlay — ban does **not** delete the friendship row (brief 2.6.4: "existing history frozen"). DM threads are created lazily on first message (`ON CONFLICT DO NOTHING RETURNING id`).
  3. **File access control:** derive on request. `GET /api/files/{id}` loads the metadata row, checks caller membership/participation, streams. Cached 30 s in an in-process `MemoryCache` keyed by `(userId, fileId)`. `file_attachments.message_id` is nullable to support paste-before-send UX; orphan sweep deletes uploads older than 1 h with null `message_id`.
  4. **Account deletion:** pure FK cascades extending Phase 1's `messages.author_id SET NULL` pattern. Rooms owned cascade to messages/memberships/files. Friendships, bans, memberships, sessions CASCADE. `file_attachments.uploader_id SET NULL` (files in other users' rooms survive with `[deleted user]` uploader). **Exception for DM retention:** `dm_threads.user_a_id` / `user_b_id` do **not** cascade; instead `dm_messages.author_id SET NULL` and the thread gets an `other_party_deleted_at` marker that freezes it read-only (distinct from `frozen_at` which marks ban-frozen threads).
  5. **Track structure:** parallel tracks, contracts-first lock — same playbook as Phase 1.
  6. **Priority:** all 13 deliverables are required. No P0/P1/P2 tags. Execution follows dependency order; if the clock runs out mid-slice, the half-built slice is the cut — no pre-committed cut order.

### Explicit out of scope for Phase 2

- Jabber/XMPP integration, federation, admin dashboard (Phase 3)
- Email-based password reset delivery (hackathon has no SMTP — the reset flow returns the token on-screen as a placeholder)
- Automated CI/CD, production Dockerfiles, secrets management, rate limiting, observability
- File virus scanning, image re-encoding, thumbnail generation
- Mobile-specific layouts, push notifications
- User profile editing beyond password change (avatar, display name, etc.) — username is immutable per brief 2.1.2

---

## Prerequisite: Lock docs/contracts.md (Phase 2 section)

**Neither track writes Phase 2 code until the Phase 2 section of `docs/contracts.md` is locked.**

Same rule as Phase 1: track B mocks against it, track A implements against it, drift is the primary failure mode. Phase 1 sections of contracts.md stay locked and untouched — Phase 2 is additive.

The one **clarification** (not a change) added to the CSRF section: `XSRF-TOKEN` cookie contains the ASP.NET Core Antiforgery **request-token** (the value returned by `IAntiforgery.GetAndStoreTokens(ctx).RequestToken`), not a copy of the framework-managed HttpOnly cookie-token. This is the bug that surfaced at the Phase 1 integration gate. Spelling it out in contracts.md prevents the same confusion in Phase 2.

### Dependency-ordered slice list

Execution sequencing (each slice unblocks the next; numbered for cross-reference only, not priority):

1. **Schema extensions** — all new tables and columns added via `EnsureCreated()`. DB volume nuke required once, coordinated across tracks.
2. **Private rooms + invitations** — uses existing `rooms.is_private` column; adds `room_invitations`.
3. **Room moderation** — owner/admin roles (reserved `'admin'` role activates), ban/unban, delete room. `room_memberships.role` transitions; adds `room_bans`.
4. **Message reply/quote + edit + delete** — extends `messages` (add `edited_at`, `deleted_at`, `reply_to_message_id`); new REST + hub events.
5. **Friends/contacts + request flow** — new `friendships` table.
6. **User-to-user ban** — new `user_bans` table; integrates with friends + DMs.
7. **DMs** — new `dm_threads` + `dm_messages` tables; parallel hub surface to rooms (`dm-{threadId}` groups, separate `SendDirectMessage`, etc.).
8. **File + image sharing** — new `file_attachments` table; upload endpoint + controlled-access download; frontend paste handler.
9. **Unread indicators for DMs** — new `dm_unreads` table; driven off `DirectMessageReceived` events.
10. **AFK presence** — server-side sweeper promotes `last_heartbeat_at > 60 s` to `'afk'`; heartbeat demotes back to `'online'`.
11. **Active session management UI** — surfaces `sessions` table (data already captured in Phase 1); revoke endpoint.
12. **Password change** — authenticated self-service.
13. **Password reset** — token-based, SMTP-less (reset token returned on-screen).
14. **Account deletion** — `DELETE /api/auth/me` with password reverify; FK cascades do the rest (per decision 4).

---

## Files to Create / Modify

### Track A — Backend

**New:**
```
api/Domain/RoomInvitation.cs
api/Domain/RoomBan.cs
api/Domain/Friendship.cs
api/Domain/UserBan.cs
api/Domain/DmThread.cs
api/Domain/DmMessage.cs
api/Domain/DmUnread.cs
api/Domain/FileAttachment.cs
api/Domain/PasswordResetToken.cs
api/Features/Rooms/RoomModerationEndpoints.cs
api/Features/Rooms/RoomInvitationEndpoints.cs
api/Features/Messages/MessageMutationEndpoints.cs          -- edit, delete
api/Features/Friends/FriendsEndpoints.cs
api/Features/Friends/FriendsDto.cs
api/Features/Friends/FriendshipService.cs                  -- row-ordering canonicalizer
api/Features/Dms/DmEndpoints.cs
api/Features/Dms/DmDto.cs
api/Features/Dms/DmService.cs                              -- lazy thread creation
api/Features/Files/FileEndpoints.cs
api/Features/Files/FileStorageService.cs                   -- filesystem I/O + access cache
api/Features/Files/FileAccessService.cs                    -- MemoryCache + membership/participation check
api/Features/Auth/SessionsEndpoints.cs
api/Features/Auth/PasswordEndpoints.cs                     -- change, forgot, reset
api/Features/Auth/AccountDeletionEndpoints.cs
api/Features/Presence/AfkSweeper.cs                        -- BackgroundService
api/Infrastructure/OrphanFileSweeper.cs                    -- BackgroundService
api.Tests/Rooms/RoomModerationTests.cs
api.Tests/Rooms/RoomInvitationTests.cs
api.Tests/Messages/MessageEditDeleteTests.cs
api.Tests/Friends/FriendRequestTests.cs
api.Tests/Friends/UserBanTests.cs
api.Tests/Dms/DmSendReceiveTests.cs
api.Tests/Dms/DmFrozenHistoryTests.cs
api.Tests/Files/FileAccessControlTests.cs
api.Tests/Files/FileSizeLimitTests.cs
api.Tests/Auth/SessionRevocationTests.cs
api.Tests/Auth/PasswordChangeTests.cs
api.Tests/Auth/AccountDeletionTests.cs
api.Tests/Presence/AfkTransitionTests.cs
```

**Modified:**
```
api/Domain/Message.cs                -- add EditedAt, DeletedAt, ReplyToMessageId
api/Data/AppDbContext.cs             -- all new DbSets + OnModelCreating (FK cascades per decision 4, friendship ordering check)
api/Hubs/ChatHub.cs                  -- EditMessage, DeleteMessage, JoinDm/LeaveDm, SendDirectMessage (+ edit/delete), broadcast new events
api/Features/Rooms/RoomsEndpoints.cs -- DELETE /api/rooms/{id}; private-room catalog filtering
api/Features/Messages/MessagesEndpoints.cs -- return edited/deleted fields (already shaped in DTO)
api/Program.cs                       -- register new route groups, MemoryCache, AfkSweeper, OrphanFileSweeper, FileStorageService
api/Api.csproj                       -- (no new packages expected; confirm in chat if needed)
```

### Track B — Frontend

**New:**
```
web/src/features/rooms/RoomSettingsModal.tsx         -- tabs: Members / Admins / Banned / Invitations / Settings (brief Appendix A)
web/src/features/rooms/RoomInvitationList.tsx
web/src/features/rooms/useRoomModeration.ts
web/src/features/rooms/useRoomInvitations.ts
web/src/features/chat/MessageEditMenu.tsx            -- edit/delete/reply actions per-message
web/src/features/chat/ReplyQuoteBanner.tsx           -- composer reply context
web/src/features/friends/FriendsPage.tsx
web/src/features/friends/FriendRequestList.tsx
web/src/features/friends/SendFriendRequestDialog.tsx
web/src/features/friends/useFriends.ts
web/src/features/friends/types.ts
web/src/features/dms/DmListSidebar.tsx
web/src/features/dms/DmWindow.tsx
web/src/features/dms/DmComposer.tsx
web/src/features/dms/useDms.ts
web/src/features/dms/useDmSignalR.ts
web/src/features/dms/types.ts
web/src/features/files/FileUploadButton.tsx
web/src/features/files/FilePasteHandler.ts           -- clipboard paste → upload
web/src/features/files/FileAttachmentView.tsx        -- inline image + download link
web/src/features/files/useFileUpload.ts
web/src/features/presence/useAfkTracker.ts           -- mousemove/keypress/focus debounced heartbeat
web/src/features/sessions/SessionsPage.tsx
web/src/features/sessions/useSessions.ts
web/src/features/auth/ChangePasswordPage.tsx
web/src/features/auth/ForgotPasswordPage.tsx
web/src/features/auth/ResetPasswordPage.tsx
web/src/features/auth/DeleteAccountDialog.tsx
web/src/features/layout/TopNav.tsx                   -- brief Appendix A layout
web/src/features/layout/RightSidebar.tsx             -- rooms + contacts accordion
```

**Modified:**
```
web/src/App.tsx                                      -- routes for friends, DMs, sessions, password change, password reset
web/src/mocks/handlers.ts                            -- MSW handlers for every Phase 2 endpoint
web/src/mocks/db.ts                                  -- mock state for friends, DMs, files, invitations, sessions
web/src/mocks/signalr.ts                             -- emit new server→client events
web/src/features/chat/MessageList.tsx                -- edited/deleted rendering, reply quotes, attachment display
web/src/features/chat/MessageComposer.tsx            -- reply context, file paste, send with attachments + replyToMessageId
web/src/features/chat/useSignalR.ts                  -- subscribe to MessageEdited/Deleted, RoomDeleted, RoomBanned, RoleChanged, RoomInvitationReceived, FriendRequest* events
web/src/features/auth/LoginPage.tsx                  -- "Keep me signed in" checkbox (brief §4)
web/src/features/auth/RegisterPage.tsx               -- "Confirm password" field (brief §4)
```

---

## Parallel Tracks

### Port coordination (same as Phase 1)
Track A owns the running stack. Track B lives on MSW until the integration gate. Track B sets `VITE_MSW_ENABLED=true` during dev; flips to `false` at the gate.

### Contracts lock
Both tracks block on `docs/contracts.md` Phase 2 section being committed and agreed. Any drift proposal goes to chat first, never a silent edit.

### MSW derives from Track A's skeleton, not the spec

Track A's first merge is a **skeleton pass**: schema + domain entities + every Phase 2 endpoint and hub method registered with its full request/response/payload types, but the bodies return `Results.StatusCode(501)` (REST) or `Clients.Caller.SendAsync("Error", new { code = "NOT_IMPLEMENTED", … })` (hub). Track B **does not write Phase 2 MSW handlers until this merge lands on `main`**. Track B's mock shapes are then derived from the committed DTO/record types (or from auto-generated TS types if we bolt that on), not from the prose in this spec or contracts.md. This forces contract-code and MSW-mock to share a single source and surfaces type-level drift before business logic is written.

### Track B merge cadence does not have to mirror Track A

Where the frontend surface of a slice is trivial (a button, a color change, a small dialog), Track B batches 2-3 thin slices into one merge rather than shipping a merge-per-slice. Where surface is comparable (moderation modal, friends+DMs, files+composer integration), Track B merges at matching cadence. The explicit batching targets are below in Track B's merge list. Mirror the Track A merge only when the surface justifies it.

### Track A — Backend (.NET 9 Minimal API)

**Merge 1 checkpoint — skeleton pass** (target: ~1.5 h):

- Schema extensions: all new tables + modified Phase 1 tables per contracts.md; one coordinated `docker compose down -v` executed in this merge. `AppDbContext` updated with DbSets, FK cascades, check constraints, indexes.
- All domain entities under `api/Domain/`: `RoomInvitation`, `RoomBan`, `Friendship`, `UserBan`, `DmThread`, `DmMessage`, `DmUnread`, `FileAttachment`, `PasswordResetToken`. Entities compile; no business logic yet.
- Every Phase 2 REST endpoint registered with full DTO types and `return Results.StatusCode(501);`. Route groups wired in `Program.cs` so every URL resolves.
- Every Phase 2 hub method stubbed with the correct argument record and a `Clients.Caller.SendAsync("Error", new { code = "NOT_IMPLEMENTED", message = "..." })` body. Server→client event broadcast sites left empty (no live events yet).
- `user-{userId}` group auto-join added to `OnConnectedAsync`.
- No new tests required in this merge beyond "endpoints reachable + return 501" smoke tests (one per route group).
- → **Merge to `main`. Track B unblocks from here.**

**Merge 2 checkpoint — private rooms + moderation + message mutations** (target: ~3 h after Merge 1):

- All new `Domain/` entities created; `AppDbContext.OnModelCreating` configures:
  - `Friendship` composite PK `(user_a_id, user_b_id)` with check constraint `user_a_id < user_b_id`
  - All FK cascades per decision 4 (rooms.created_by_id → CASCADE, memberships → CASCADE, friendships → CASCADE both sides, user_bans → CASCADE both sides, dm_threads.user_a/user_b → **Restrict** with app-level `other_party_deleted_at` flip on account delete, dm_messages.author_id → SET NULL, file_attachments.uploader_id → SET NULL, sessions → CASCADE, room_invitations → CASCADE)
  - `HasIndex` on `dm_messages(thread_id, watermark DESC)` and `file_attachments(room_id)` / `(dm_thread_id)` / `(uploader_id)`
  - `DmThread` has `current_watermark`, `frozen_at`, `other_party_deleted_at`
- `POST /api/rooms` accepts `isPrivate` flag; catalog filters private rooms out for non-members (decision: private rooms never appear in `GET /api/rooms` unless the caller is a member or has a pending invitation).
- `POST /api/rooms/{id}/invitations` (owner/admin only) — looks up target by username, creates row, fires `RoomInvitationReceived` hub event to invited user.
- `GET /api/invitations` — my incoming invitations.
- `POST /api/invitations/{id}/accept` / `decline` — accept inserts `room_memberships` + marks invitation consumed; decline marks declined.
- `DELETE /api/rooms/{id}` — owner only; cascades do the work; broadcasts `RoomDeleted` hub event to room group **before** deletion so members can navigate away.
- Room moderation endpoints (see contracts.md Phase 2 REST): promote, demote, ban, unban, list members, list bans.
- Hub: `EditMessage`, `DeleteMessage` for rooms with permission checks (edit = author only; delete = author or room admin/owner).
- Message DTOs populate `editedAt`, `deletedAt`, `replyToMessageId`. Soft-delete: `deletedAt` set, `content` replaced with empty string server-side on retrieve.
- Tests:
  - Private-room catalog filtering; non-member cannot `JoinRoom` hub invoke or `GET /api/rooms/{id}/messages`.
  - Invitation flow (create, accept, decline, double-accept, accept after leave, invite an existing member rejected).
  - Role transitions (owner promotes to admin, admin bans member, banned user cannot rejoin, banned user's history visible but author flagged).
  - Room delete cascades (messages + memberships + files gone; invitations gone).
  - Message edit permission (non-author 403); edit persists `edited_at`; hub broadcasts `MessageEdited`.
  - Message delete permission (author OR room admin/owner OK; admin deleting another admin's message OK per brief 2.5.5); soft-delete; hub broadcasts `MessageDeleted`.
- → **Merge to `main`**

**Merge 3 checkpoint — friends + DMs + ban + unread** (target: ~4 h after Merge 2):

- `Friendship` endpoints: send request (by username), list, accept, decline, remove. `FriendshipService` canonicalizes the row tuple.
- `UserBan` endpoints: ban, unban. On ban: flip `dm_threads.frozen_at` for the thread with the banned user (if any). DM send enforces `user_bans` veto and `friendships.status = 'accepted'`.
- DM endpoints + hub surface: `GET /api/dms` list, `GET /api/dms/{threadId}/messages` cursor paginated, `POST /api/dms/open/{userId}` ensures thread exists (lazy), hub `JoinDm` / `LeaveDm` / `SendDirectMessage` / `EditDirectMessage` / `DeleteDirectMessage`.
- `dm_unreads` mirrors `room_unreads` mechanics.
- Hub broadcasts the new events (see contracts.md Phase 2 SignalR): `DirectMessageReceived`, `DirectMessageEdited`, `DirectMessageDeleted`, `FriendRequestReceived`, `FriendRequestAccepted`, `FriendRequestDeclined`, `FriendRemoved`, `UserBanned`.
- Tests:
  - Friend request flow (send, duplicate request rejected, self-request rejected, accept, decline, remove).
  - Friendship row ordering invariant holds regardless of request direction.
  - Ban: banned user cannot send DM (`FORBIDDEN`), existing DM history readable, thread shows `frozen`; unban lifts freeze.
  - DM send: non-friend rejected (`NOT_FRIENDS`), friend with ban rejected (`USER_BANNED`), friend accepted message persists + broadcasts.
  - DM edit/delete permission mirror room semantics (delete by author only — no admin equivalent in a 2-person thread).
  - DM idempotency + watermark scoped per-thread.
  - DM unread increments for the other party, resets on `JoinDm`.
- → **Merge to `main`**

**Merge 4 checkpoint — files + sessions + password + account + AFK** (target: ~3 h after Merge 3):

- `FileStorageService`: writes uploads to `/var/chat-files/{yyyy}/{mm}/{fileId}` (filesystem layout avoids huge flat dirs).
- `POST /api/files`: multipart upload; validates size (20 MB file, 3 MB image — sniffed by content-type prefix `image/`); writes filesystem; inserts `file_attachments` row with `message_id = NULL`.
- Frontend then sends `SendMessage` / `SendDirectMessage` with `attachmentFileIds: [fileId]`; server sets `file_attachments.message_id` / `dm_message_id` on success.
- `GET /api/files/{id}`: `FileAccessService` checks caller against room membership or DM participation (or pre-commit upload: `uploader_id = caller`). 30 s `MemoryCache`. Streams with `Content-Disposition` preserving original filename.
- `OrphanFileSweeper` (BackgroundService): every 10 min deletes `file_attachments` rows (and filesystem files) where `message_id IS NULL AND dm_message_id IS NULL AND created_at < now() - interval '1 hour'`.
- Sessions endpoints: `GET /api/auth/sessions` lists, `POST /api/auth/sessions/{id}/revoke` marks `is_revoked = true` (next request fails session validation).
- Password endpoints: change (verifies current password via `IPasswordHasher`), forgot (generates token in `password_reset_tokens` table, returns token in response for hackathon), reset (consumes token, sets new hash).
- `DELETE /api/auth/me`: reverifies password; `_db.Users.Remove(user); SaveChangesAsync();` — cascades handle the rest; for DM threads, pre-step flips `other_party_deleted_at` on all threads the deleting user is part of and sets `author_id = NULL` on their dm_messages (handled explicitly because DM FKs are Restrict, not Cascade).
- `AfkSweeper` (BackgroundService): every 15 s scans `user_presence` where `status = 'online' AND last_heartbeat_at < now() - interval '60 seconds'`, flips to `'afk'`, broadcasts `PresenceChanged`.
- Tests:
  - File upload size limit (20 MB file, 3 MB image) enforced; 20 MB + 1 byte rejected with 413.
  - File download access control: room member OK, non-member 403; DM participant OK, non-participant 403; uploader pre-commit OK.
  - Orphan sweep deletes old orphans, leaves attached files alone.
  - Session revoke: subsequent request with revoked cookie returns 401.
  - Password change with wrong current password → 400; correct → 200; old password no longer works.
  - Password reset flow: token consumed once, expired tokens rejected.
  - Account deletion: user's owned rooms + their messages/memberships/files gone; user's memberships in others' rooms gone; user's DM threads persist with `other_party_deleted_at` set; user's messages in other rooms have `author_id = null` and display as `[deleted user]`.
  - AFK transition at 60 s; any heartbeat within 60 s keeps `online`; multi-tab: one tab sending heartbeats is sufficient to keep both tabs' user `online`.
- → **Merge to `main`**

### Track B — Frontend

Track B does not start Phase 2 work until Track A's Merge 1 (skeleton pass) is on `main`. Track B's MSW handlers and TS types are derived from the committed DTO/record types — not from the prose in this spec. When Track B finds a shape that's under-specified in the committed stubs, it proposes a contracts.md change in chat; does not improvise.

**Merge 1 checkpoint — layout + MSW scaffold + moderation + message mutations** (target: ~3-4 h after Track A Merge 1):

- MSW handlers for **every Phase 2 endpoint** from the skeleton (realistic mock data, not 501 echoes). MSW db extended with friends, DMs, files, invitations, sessions, bans. MSW signalr emitter wired for every new server→client event.
- Top nav + right sidebar per brief Appendix A (`TopNav.tsx`, `RightSidebar.tsx`).
- `LoginPage` "Keep me signed in" toggle; `RegisterPage` "Confirm password" field.
- `RoomSettingsModal` with tabs Members / Admins / Banned / Invitations / Settings. Owner/admin-gated UI sections.
- Private room creation toggle; invitation send form + accept/decline UI in a top-nav badge.
- `MessageEditMenu`: per-message dropdown Edit/Delete/Reply with permissions computed client-side from `authorId == me`, `myRole`.
- `ReplyQuoteBanner` in `MessageComposer`; `MessageList` renders edited / deleted / quoted-reply states.
- `useSignalR` subscribes to `MessageEdited`, `MessageDeleted`, `RoomInvitationReceived`, `RoleChanged`, `RoomBanned`, `RoomDeleted` with React Query cache updates; `RoomDeleted` / `RoomBanned` navigate user out.
- → **Merge to `main`**

**Merge 2 checkpoint — friends + DMs** (target: ~4 h after Merge 1):

- `FriendsPage`: incoming requests, outgoing requests, friends list with ban/remove actions; `SendFriendRequestDialog` + "Send friend request" action from the room member list.
- `DmListSidebar` (slots into right sidebar accordion) with unread badges.
- `DmWindow` / `DmComposer` mirror `ChatWindow` / `MessageComposer` against DM endpoints + `dm-{threadId}` hub group.
- `useDmSignalR` parallel to room `useSignalR`; subscribes to `DirectMessageReceived` / `Edited` / `Deleted`, `FriendRequest*`, `UserBanned`.
- Ban-frozen state: inline banner in `DmWindow` when `frozenAt != null` or `otherPartyDeletedAt != null`; composer disabled.
- User-ban UI (Block/Unblock action in friends list + friend-context menu) lands in this merge as a thin add — it's one button bound to one endpoint, batched here rather than standalone.
- → **Merge to `main`**

**Merge 3 checkpoint (batched thin surfaces) — files + sessions + password + account + AFK** (target: ~3 h after Merge 2):

This merge intentionally bundles five thin frontend surfaces. Each one alone is ≤ 200 LOC; shipping them as individual merges would be churn.

- **Files:** `FileUploadButton` (composer), `FilePasteHandler` (clipboard listener), `FileAttachmentView` (inline image + download link with original filename). Send-message flow extended to pass `attachmentFileIds`.
- **Sessions:** `SessionsPage` — list + "This device" marker + Revoke button. Revoking the current session clears cookie and redirects to login.
- **Password:** `ChangePasswordPage` (authenticated); `ForgotPasswordPage` + `ResetPasswordPage` (unauth; reset token displayed on-screen).
- **Account:** `DeleteAccountDialog` — password reverify + explicit confirm; on success clears session and redirects to register.
- **AFK** (trivially thin — color + hook): `useAfkTracker` debounced heartbeat on `mousemove` / `keypress` / `focus`; `PresenceIndicator` gets a `'afk'` branch (yellow dot).
- MSW handlers updated to emit `PresenceChanged` with `'afk'`, return files, sessions, password tokens, and account-delete success.
- → **Merge to `main`**

### Integration gate

After Track A reaches Merge 4 and Track B reaches Merge 3:

1. Track A: `docker compose down -v && docker compose up --build` (schema churn demands volume nuke).
2. Track B: `VITE_MSW_ENABLED=false`; `npm run dev`.
3. Run the gate journey (Scorecard item 1) across two browser profiles.
4. Fix integration issues in the relevant worktree.

---

## Scorecard

- [ ] **End-to-end journey passes across two browser profiles.** User A registers, creates a **private** room, invites user B by username. User B accepts the invitation, joins, posts a message, user A replies with a quote, user A edits their reply (B sees "edited"), user B deletes the edited message (as admin after A promotes them) and A sees "Message deleted" placeholder. User A pastes an image into the room, B sees the image inline and can download it with the original filename; a third user C who is not a room member attempts `GET /api/files/{id}` and gets 403. User A sends B a friend request, B accepts, they exchange DMs including a file attachment. User A bans user B user-to-user: B's DM thread with A freezes read-only, existing messages still render, B's composer is disabled. User A opens Sessions page, sees two sessions (two profiles), revokes the other. Full journey runs against `docker compose up`, not MSW.

- [ ] **Schema + FK cascades behave as designed.** A seeded user X owns two rooms, is member of two more, has three friends, one user-to-user ban, two DM threads with messages, five file attachments across rooms and DMs. `DELETE /api/auth/me` (with correct password) executes and afterward: X's owned rooms gone (messages/memberships/files gone with them); X's memberships in others' rooms gone; friendships with X gone; user_bans involving X gone; sessions for X gone; X's DM threads **persist** with `other_party_deleted_at` set; X's dm_messages have `author_id = NULL`; X's messages in other users' rooms persist with `author_id = NULL` and render as `[deleted user]`; file_attachments X uploaded in others' rooms persist with `uploader_id = NULL`. Automated via `api.Tests/Auth/AccountDeletionTests.cs`.

- [ ] **DM ban freezes history without data loss.** Integration test: A and B are friends with 10 DM messages. A bans B. `GET /api/dms/{threadId}/messages` returns all 10 messages for both A and B. `SendDirectMessage` from B returns hub `Error { code: "USER_BANNED" }`. Thread DTO `frozenAt` is non-null for both parties. A unbans B; the `frozenAt` clears; B can send; A receives.

- [ ] **File access control rejects non-participants and caches within-session.** Integration test (Playwright): A uploads image to room R; B (not in R) receives 403; B joins R, receives 200; B leaves R, within 30 s receives 200 (cache), after 30 s receives 403 (cache expiry). Image size 3 MB + 1 byte rejected at upload with 413. File size 20 MB + 1 byte rejected at upload with 413.

- [ ] **AFK transition at 60 s, recovers on heartbeat, multi-tab stays online.** Integration test: user A in profile A logs in; `useAfkTracker` disabled in test; wait 65 s; user B observes A's presence flip to `afk` within 75 s of login (60 s threshold + 15 s sweeper interval). A moves mouse; within 15 s B observes `online`. A opens second tab; first tab goes idle but second tab sends heartbeats; A stays `online` from B's view.

- [ ] **Message edit + delete permission matrix.** Integration test covers: author edits own message OK; non-author edit rejected; room admin edit rejected (admins can delete, not edit — brief 2.5.4 "user can edit their own messages"); author deletes own OK; room admin deletes someone else's OK; room member (non-admin) deletes someone else's rejected; deleting an already-deleted message is idempotent.

- [ ] **Contracts doc is the sole source of truth, Phase 1 section unchanged.** `git diff main..phase-2` on `docs/contracts.md` adds only the Phase 2 section + the one-line CSRF clarification in the Phase 1 section. No Phase 1 endpoint shape is altered.

- [ ] **Track A Merge 1 (skeleton pass) lands before Track B starts Phase 2 MSW work.** Verified by git log: the first commit on Track B's Phase 2 branch that touches `web/src/mocks/handlers.ts` or any `web/src/features/*/types.ts` for a Phase 2 feature has Track A's skeleton commit in its ancestry. Prevents Track B from deriving mock shapes from the spec in isolation — shapes come from committed backend code.

---

## Out of Scope

- Jabber/XMPP (Phase 3)
- Server federation (Phase 3)
- Admin dashboard (Phase 3)
- Polish / wireframe review / demo script (Phase 3)
- Email delivery for password reset (hackathon has no SMTP — reset returns token on-screen)
- Avatar upload, display name, other profile fields
- Message search, reactions, threading beyond quote-reply
- Push notifications
- Attachment virus scan / image re-encoding / thumbnail generation
- Rate limiting, metrics, distributed tracing

---

## Notes

### Schema churn needs one coordinated DB volume nuke

Because we use `EnsureCreated()`, adding columns to existing tables (`messages.edited_at`, `messages.deleted_at`, `messages.reply_to_message_id`) won't apply to a populated DB. Plan a single `docker compose down -v && docker compose up --build` at the start of Phase 2 Merge 1; subsequent merges are additive-only (new tables only, no column changes to existing tables) to avoid further volume nukes. If a column change becomes necessary mid-Phase-2, coordinate a second volume nuke across both tracks.

### Room-moderation permission matrix (contracts.md is authoritative — restated for convenience)

| Action | Owner | Admin | Member |
|---|---|---|---|
| Delete room | ✓ | ✗ | ✗ |
| Promote member to admin | ✓ | ✗ | ✗ |
| Demote admin to member | ✓ | ✗ | ✗ |
| Ban a member | ✓ | ✓ (except owner/admins) | ✗ |
| Unban | ✓ | ✓ | ✗ |
| Invite user (private room) | ✓ | ✓ | ✗ |
| Delete any message in room | ✓ | ✓ | ✗ |
| Edit own message | ✓ | ✓ | ✓ |
| Edit other's message | ✗ | ✗ | ✗ |

### Friendship row canonicalization

```csharp
public static class FriendshipKey
{
    public static (Guid a, Guid b) Canonicalize(Guid x, Guid y)
        => x.CompareTo(y) < 0 ? (x, y) : (y, x);
}
```
Every writer must use this. DB-level check constraint `user_a_id < user_b_id` backstops it.

### DM watermark semantics

Each `dm_thread` has its own `current_watermark` counter, advanced atomically on `SendDirectMessage` via the same `UPDATE … RETURNING` pattern as rooms. DM pagination uses `before` / `since` on this thread-scoped watermark. This is why the DM surface is structurally parallel to rooms — watermark, idempotency, pagination, gap recovery all replicate.

### Presence broadcast scope on AFK

`PresenceChanged` with `afk` broadcasts to the same set of room groups as `online`/`offline` (all rooms the user is a member of). DM windows listen to `PresenceChanged` filtered to the thread's other party — no separate DM presence group needed.

### `SendMessage` polymorphism avoidance

Hub exposes **separate** `SendMessage` (rooms) and `SendDirectMessage` (DMs) methods rather than one polymorphic `SendMessage` with a union type. Matches decision 1 (separate tables) and avoids runtime-typed conditionals in the hub. Same rationale for `Edit` / `Delete` and for the broadcast events (`MessageReceived` vs `DirectMessageReceived`).

### Password reset without SMTP

Brief doesn't name a delivery channel; hackathon has no outgoing email. `POST /api/auth/forgot-password` returns `{ resetToken, expiresAt }` in the response body for the happy path (email unknown → still returns 200 with a fake token to avoid user-enumeration oracle). Frontend displays the token in a "Your reset link:" text block. In a real deployment this would be emailed; the endpoint shape is already correct for that substitution later.

### Agent team protocols (Phase 2)

CLAUDE.md's agent-team rules still apply: `MAX_ITERATIONS=8` per builder, reviewer teammate when 3+ builders active, reflection-before-retry. Phase 2's larger surface makes the reviewer role more load-bearing — spawn one by default, not "when builders mark complete."
