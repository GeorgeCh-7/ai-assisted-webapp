# Known Bugs — End of Phase 3

## Resolved in Phase 3

- **Bug 2** (new rooms don't appear without refresh) — fixed via `RoomCreated` broadcast to `public-rooms-catalog` SignalR group.
- **Bug 3** (new DM threads don't appear without refresh) — fixed via `DmThreadCreated` broadcast on first thread creation.
- **Bug 4** (user-scoped events lost on non-room pages) — fixed via shared `HubProvider` at App root.
- **Data protection key regeneration on API restart** — fixed by mounting `dp_keys` volume at `/root/.aspnet/DataProtection-Keys`.
- **File attachment persistence** — `AttachmentFileIds` was accepted by the hub but never written to the DB; fixed in `ChatHub.cs` for both room and DM sends. Message history endpoints now load and return attachments.
- **XMPP MUC subdomain not resolvable via S2S** — `conference.chat.local` was not in Docker DNS, causing ejabberd's `xmpp_stream_out` to fail A-record lookup during S2S. Fixed by adding `conference.chat.local` and `conference.fed.local` as explicit Docker network aliases alongside their respective ejabberd services.

---

## Still Deferred

These were intentionally not fixed. Do not treat as new scope without an explicit decision.

## Bug 1 — Private rooms appear in public catalog
- Observed: user C (not a member of any private room) sees private rooms in the public catalog
- Expected per contracts.md: private rooms excluded unless caller is member or invitee
- Backend filter verified correct (`RoomsEndpoints.cs:39-42`)
- MSW filter verified correct (`handlers.ts:613-624`)
- Actual cause: unknown — requires UI-level investigation of whether there are separate "public" vs "private" views or one catalog rendering twice
- Impact: visible UX confusion; judges will notice
- Fix effort estimate: 30-60 minutes