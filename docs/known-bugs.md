# Known Bugs — End of Phase 3

## Resolved in Phase 3

- **Bug 2** (new rooms don't appear without refresh) — fixed via `RoomCreated` broadcast to `public-rooms-catalog` SignalR group.
- **Bug 3** (new DM threads don't appear without refresh) — fixed via `DmThreadCreated` broadcast on first thread creation.
- **Bug 4** (user-scoped events lost on non-room pages) — fixed via shared `HubProvider` at App root.
- **Data protection key regeneration on API restart** — fixed by mounting `dp_keys` volume at `/root/.aspnet/DataProtection-Keys`.

---

## Phase 2 Bugs Still Deferred

These were intentionally not fixed in Phase 3. Do not treat as new scope without an explicit decision.

## Bug 1 — Private rooms appear in public catalog
- Observed: user C (not a member of any private room) sees private rooms in the public catalog
- Expected per contracts.md line 441: private rooms excluded unless caller is member or invitee
- Backend filter verified correct (`RoomsEndpoints.cs:39-42`)
- MSW filter verified correct (`handlers.ts:613-624`)
- Actual cause: unknown — requires UI-level investigation of whether there are separate "public" vs "private" views or one catalog rendering twice
- Impact: visible UX confusion; judges will notice
- Fix effort estimate: 30-60 minutes

## Bug 2 — New rooms don't appear in catalog without refresh
- Cause: no `RoomCreated` hub event exists
- Planned fix: Phase 3 real-time discoverability section

## Bug 3 — New DM threads don't appear in sidebar without refresh  
- Cause: no `DmThreadCreated` hub event exists
- Planned fix: Phase 3 real-time discoverability section

## Bug 4 — Invitations / friend request updates don't appear without refresh (partial)
- FriendRequestReceived: wired ✓
- FriendRequestAccepted: wired ✓
- FriendRequestDeclined: wired in commit 497e120 ✓
- FriendRemoved: wired ✓
- RoomInvitationReceived: wired ✓
- UserBanned: wired ✓
- Status: if you are still seeing notifications not appear after the above fixes, the bug is somewhere *other* than event subscription — possibly component rendering, query key mismatch, or a listener registered in one hook but the UI reads from a different hook's data
- Next diagnostic: in DevTools Network tab while logged in, filter WebSocket frames and verify the events arrive in real time when triggered from a second browser