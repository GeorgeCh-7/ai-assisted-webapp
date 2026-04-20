# Known Bugs — End of Phase 3

## Resolved in Phase 3

- **Bug 2** (new rooms don't appear without refresh) — fixed via `RoomCreated` broadcast to `public-rooms-catalog` SignalR group.
- **Bug 3** (new DM threads don't appear without refresh) — fixed via `DmThreadCreated` broadcast on first thread creation.
- **Bug 4** (user-scoped events lost on non-room pages) — fixed via shared `HubProvider` at App root.
- **Data protection key regeneration on API restart** — fixed by mounting `dp_keys` volume at `/root/.aspnet/DataProtection-Keys`.
- **File attachment persistence** — `AttachmentFileIds` was accepted by the hub but never written to the DB; fixed in `ChatHub.cs` for both room and DM sends. Message history endpoints now load and return attachments.
- **XMPP MUC subdomain not resolvable via S2S** — `conference.chat.local` was not in Docker DNS, causing ejabberd's `xmpp_stream_out` to fail A-record lookup during S2S. Fixed by adding `conference.chat.local` and `conference.fed.local` as explicit Docker network aliases alongside their respective ejabberd services.

---

## Resolved in UI Sweep (2026-04-20)

- **BUG-01** (ejabberd `(unhealthy)` in docker ps) — `ejabberdctl status` uses Erlang RPC which fails due to container hostname mismatch; replaced healthcheck with `wget` HTTP probe on `:5280`. Both ejabberd services now reach `(healthy)`.
- **BUG-02** (presence shows offline for existing room members on join) — fixed via `useRoomMembers` hook in `ChatWindow.tsx` that seeds `['presence', userId]` from `GET /api/rooms/{id}/members` on room load. Verified: Bob's indicator shows online in Alice's view within 5s.
- **BUG-03** (oversized files get 400 before 413) — moved size check before scope GUID parse in `FileEndpoints.cs` so 413 fires regardless of scopeId format.
- **BUG-04** (whitespace username error message echoes raw spaces) — added `InvalidUserName` branch in `AuthEndpoints.cs` that returns "Username contains invalid characters" instead of Identity's default message.
- **BUG-05** (public room invitation error message confusing) — changed to "Invitations are only valid for private rooms" in `RoomInvitationEndpoints.cs`.
- **BUG-06** (PresenceIndicator not queryable by automated tests) — added `data-presence={status}` attribute to the indicator span.

## Resolved post-sweep (2026-04-20)

- **Room/DM unread badges not updating in real-time** — `RoomUnreadUpdated` and `DmUnreadUpdated` SignalR events added. Server broadcasts to each member's `user-{id}` group after incrementing the DB counter; `useGlobalHubEvents` handles both events to call `incrementUnread` and invalidate `['dms']` respectively. Verified by `presence-notifications.spec.ts` tests 8 and 9.
- **TopNav Contacts badge missing** — `useFriendRequests()` was not wired into `TopNav`; the badge could not render even when incoming requests existed. Fixed.
- **Presence not seeded from friends list** — `useFriends` hook now seeds `['presence', userId]` for each friend on load (same pattern as `useRoomMembers`).
- **TanStack Query devtools visible during demo** — gated on `VITE_SHOW_DEVTOOLS=true`; unset by default.

## Accepted Behaviors (not bugs, no fix planned)

- **File scope validated before size in edge case** — API correctly validates scope/scopeId before file size for malformed requests. Real UI always sends a valid scope, so users always see 413. Accepted: validation ordering is sensible.
- **Public room invitation API message** — UI correctly hides the invitation tab for public rooms; the error is only reachable by direct API callers.

---

## Still Deferred

These were intentionally not fixed. Do not treat as new scope without an explicit decision.

## Bug 1 — Private rooms appear in public catalog
- Observed: user C (not a member of any private room) sees private rooms in the public catalog
- Expected per contracts.md: private rooms excluded unless caller is member or invitee
- Backend filter verified correct (`RoomsEndpoints.cs:39-42`)
- MSW filter verified correct (`handlers.ts:613-624`)
- Actual cause: unknown — requires UI-level investigation
- Impact: visible UX confusion; judges will notice
- Fix effort estimate: 30-60 minutes