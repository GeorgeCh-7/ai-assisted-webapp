# Demo Script

> **Status: READY.** Filled in during Phase 3 Slice 6. Every step below has been manually verified. Flaky steps are called out in the Known Flakes section.

## Pre-flight (before judges join)

- `docker compose down -v && docker compose up --build` — clean DB, fresh state. Takes ~60s.
- Register two accounts: **alice** / `Password1!` and **bob** / `Password1!`.
  - Do this in advance — registration is fast but first-startup EF schema creation adds ~2s.
- Open two browser windows (one normal, one incognito). Both logged in — alice in normal, bob in incognito. Both on `http://localhost:5173`.
- Make alice and bob friends before Act 4 (send + accept request during Acts 1–3 setup time).
- Pre-seed at least one public room (`#general`) and join both accounts before the demo clock starts.
- Clear browser zoom — aim for legible text on a shared screen.
- Close unrelated tabs, DevTools, and the TanStack Query devtools panel (click the button at bottom-right to collapse).
- If Slice 7 shipped: start Gajim, verify MUC `bridge@conference.chat.local` joins cleanly.

**Target runtime: 6 minutes end-to-end.** If rehearsal goes over 7 min, cut Act 5 first.

---

## Act 1 — Auth + catalog discovery (60s)

1. **Register.** In incognito, hit `/register`. Fill username + password + confirm. Submit → lands on catalog.
2. **Login.** In normal window, show `/login`. Enter alice's username, password. Click "Keep me signed in". Submit → lands on catalog.
3. **Catalog landing.** Show the Public Rooms list. Type in the filter box — list narrows live (300ms debounce, no extra round-trip). Point out Public / Private Rooms nav tabs.

**Narration:**
- Password hashing uses **Argon2id** (Konscious.Security.Cryptography) — not Identity's default BCrypt, which is a brief requirement.
- Sessions are cookie-based with **CSRF protection** via the antiforgery request-token pattern on every mutating endpoint.
- The catalog supports **keyset pagination** (name + UUID cursor) so it scales to thousands of rooms without offset degradation.

---

## Act 2 — Real-time core chat + catalog (90s)

1. **Create a room.** Alice clicks "New room", types `live-demo`, submits.
   - **Bob's catalog updates within ~1s without refresh.** Call this out — it's the Phase 3 `public-rooms-catalog` SignalR group. Bob did nothing; the row just appeared.
2. **Both join + chat.** Bob clicks "join". Both open the room. Alice sends "Hello from alice". Bob sends "Hello from bob". Messages render with bubble layout — own messages right, others left.
3. **Edit + delete.** Alice hovers her message → actions appear. Edit → changes text → "edited" marker appears in Bob's view. Delete → "[Message deleted]" placeholder in both views.
4. **Reply / quote.** Bob clicks reply on Alice's message. Quote chip with Alice's username appears in Bob's composer. Bob sends the reply — quote block renders above Bob's bubble in both views.
5. **Presence.** Close Bob's incognito window. Within 5s Alice sees Bob's indicator flip offline. Reopen → flips back online.

**Narration:**
- Message sends are **idempotency-keyed** — if the network drops mid-send, the server deduplicates on reconnect so no duplicate messages appear.
- Message history uses **watermark cursors** (monotonic per-room sequence), not offset pagination — scales to 10k+ messages with constant-time older-message fetches.
- The catalog real-time update uses a new SignalR group `public-rooms-catalog`. Every connected client joins on hub connect. The `RoomCreated` / `RoomDeleted` broadcast fires *after* the DB commit to avoid a refetch race.

---

## Act 3 — Private rooms + moderation (60s)

1. **Private room.** Alice creates a private room `secret-room` (check the "Private" toggle). Confirm it does **not** appear in Bob's Public Rooms catalog — Bob is not a member and not invited.
2. **Invitation.** Alice opens the room settings → Invitations tab → invites Bob by username. Bob's invitation badge in the nav updates within ~1s without refresh (`RoomInvitationReceived` event, wired in Phase 2).
3. **Accept + chat.** Bob accepts → joins `secret-room`. Both exchange a message.
4. **Promote.** Alice opens settings → Members → promotes Bob to Admin. Bob's role badge updates live in the member list (`RoleChanged` event).

**Narration:**
- Private rooms are **not listed** in the public catalog; access requires membership or a pending invitation (brief 2.5.x).
- Role system: owner → admin → member. **Permission matrix**: owner can ban anyone, admin can only ban members — enforced in the backend, not just the UI.

---

## Act 4 — Friends + DMs (90s)

1. **Friend request.** Alice opens Contacts → "Add contact" → types Bob's username → sends. Bob's `/friends` page shows the incoming request within ~1s without refresh (`FriendRequestReceived` event).
2. **Accept.** Bob accepts. Both sides' friends lists update live (`FriendRequestAccepted` event invalidates both `['friends']` and `['friend-requests']`).
3. **Open DM.** Alice clicks the chat icon next to Bob on the friends page. A DM thread opens. **Bob's DM sidebar shows the new thread within ~1s without refresh** — Phase 3 `DmThreadCreated` event, only fires on first thread creation.
4. **Exchange DMs.** Send 2–3 messages each. Bubble layout works identically to rooms. Attach a file (drag or clip icon) — uploads inline, filename preserved.
5. **Block.** Alice clicks the block (🚫) icon on Bob's friends row. Bob's DM composer goes disabled, frozen banner appears, existing history stays visible. Alice unblocks → composer re-enables.

**Narration:**
- DMs use a **separate watermark namespace** from rooms, so DM and room message IDs never collide.
- Block/ban uses `dm_threads.frozen_at` to preserve history while disabling new messages — brief requirement 2.6.4.
- The `DmThreadCreated` broadcast targets `user-{userId}` groups so both parties' sidebars update regardless of which page they're on.

---

## Act 5 — Sessions (optional, 45s — cut first if running long)

1. **Sessions page.** Alice opens Sessions. Shows two active sessions (normal + incognito) with browser label + IP + last-seen time.
2. **Revoke.** Alice revokes the other session. Within ~30s Bob's next action gets a 401 and auto-redirects to `/login`.
3. **Change password.** Alice opens Change Password from the user menu. Changes password. Old password no longer works.

---

## Act 6 — XMPP (only if Slice 7 shipped)

**Full bridge shipped:**
1. Open Gajim. Show MUC `bridge@conference.chat.local` connected.
2. Gajim user sends a message. It appears in Alice's room view within 3s, badged "via Jabber".
3. Alice replies in-app — Gajim receives the reply.

**ejabberd standalone only:**
1. Open Gajim, connect to ejabberd. Show Connected state.
2. Second Gajim account joins the MUC, exchange a message.
3. Narrate: "ejabberd is running alongside our server. The bridge into our app was cut at the budget gate — `docs/xmpp-design.md` has the full architecture."

**Not shipped:** Skip Act 6 entirely. Mention briefly in the close.

---

## Act 7 — Close (30s)

- "Everything you saw runs in a single `docker compose up`. No external services beyond Postgres."
- "Phase 3 thesis: real-time UX first, Jabber surface second, with an explicit fallback ladder so XMPP variance can't eat the demo."
- Point judges to `docs/known-bugs.md` for anything not demoed and `docs/roadmap.md` for what Phase 3 addressed.

---

## Known flakes (update during rehearsal)

- **API restart invalidates all sessions.** If the API container is restarted mid-demo (e.g. to pick up a code change), all users get logged out. Pre-warm sessions only after the final `docker compose up --build`.
- **Session expiry is 30s after revoke** (server-side check interval). For Act 5, don't rush — wait the full 30s for Bob's tab to bounce to login.
- **Presence heartbeat is 30s.** "Bob goes offline" in Act 2 step 5 takes up to 35s after closing the tab. Pre-warn judges: "presence updates are heartbeat-driven, you'll see it flip in a moment."

## Hard cuts if demo is running long

In order — cut first from the top:

1. Act 5 (sessions + password).
2. Act 3 step 4 (promote/demote — leave invitation beat only).
3. Act 4 step 5 (DM block) — keep friend request + open-DM beats.
4. Act 6 (XMPP) — honest cut; offer to show after Q&A.
