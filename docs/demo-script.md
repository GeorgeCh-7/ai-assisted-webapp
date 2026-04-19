# Demo Script

> **Status: SKELETON.** Narration to be filled in during Phase 3 Slice 6. Every step below should be rehearsed and manually tested before the demo. Any step that flakes is either fixed or cut — do not demo what isn't reliable.

## Pre-flight (before judges join)

- `docker compose down -v && docker compose up --build` — clean DB, fresh state.
- Open two browser profiles (one normal, one incognito). Confirm both can reach `http://localhost:5173`.
- Clear browser zoom / make sure text is legible on whatever screen is being shared.
- Close unrelated tabs and DevTools (unless a specific step requires them).
- Pre-seed accounts: `alice@demo.local` / `password123` and `bob@demo.local` / `password123`. Register both beforehand so demo doesn't open on a slow first-registration path.
- If Slice 7 shipped: start Gajim, pre-configure `gajim-user-a@chat.local` account, verify MUC `bridge@conference.chat.local` joins cleanly.

**Target runtime: 6 minutes end-to-end.** If the walkthrough rehearses longer than 7, cut one of the optional beats (typically the XMPP bridge or the sessions revoke).

---

## Act 1 — Auth + catalog discovery (60s)

1. **Register flow.** Open a fresh incognito window. Show register form (email + username + password + confirm-password).
2. **Login flow.** In another profile, log in as Alice. Show the "Keep me signed in" toggle — click through.
3. **Catalog landing.** Show the public room catalog with search. Search for a seeded room.

*Narration points (fill in during Slice 6):*
- Argon2id password hashing (brief-compliant, not Identity's default BCrypt).
- Cookie-based session with CSRF via request-token pattern.

---

## Act 2 — Real-time core chat + catalog (90s)

1. **Create a room.** Alice creates a new public room. **Bob's catalog (in the other profile) updates within 2 s without refresh.** This is the Slice 3 beat — call it out explicitly.
2. **Both join + chat.** Both profiles join the new room. Exchange three messages.
3. **Edit + delete.** Alice edits a message — "edited" marker appears in Bob's view. Alice deletes a message — "Message deleted" placeholder in both views.
4. **Reply / quote.** Bob replies to one of Alice's messages. Quote chip renders in the reply.
5. **Presence.** Close Bob's tab. Alice sees Bob go offline within 5 s. Reopen — Bob flips back to online.

*Narration points:*
- Idempotency-keyed message sends with race-safe dedup.
- Watermark-based cursor pagination scales to 10k+ messages.
- Real-time catalog update is Phase 3's new SignalR group (`public-rooms-catalog`).

---

## Act 3 — Private rooms + moderation (60s)

1. **Create a private room.** Alice creates a private room. Confirm it doesn't appear in Bob's catalog.
2. **Invitation.** Alice invites Bob by username. Bob's invitation badge updates within 2 s without refresh (Slice 1 beat — user-scoped events now flow regardless of page).
3. **Accept + chat.** Bob accepts, joins, sends a message.
4. **Promote + ban.** Alice promotes Bob to admin; Bob's badge updates live. Alice demotes, then bans a third user (or simulates with a throwaway account).

*Narration points:*
- Role-gated permission matrix (owner/admin/member).
- Live role updates via `RoleChanged` hub event.

---

## Act 4 — Friends + DMs (90s)

1. **Friend request.** Alice sends friend request to Bob by username. Bob's `/friends` page updates within 2 s without refresh.
2. **Accept.** Bob accepts. Both sides' friends list updates live.
3. **Open DM.** Alice clicks DM on Bob's friend row. **Bob's DM sidebar updates within 2 s without refresh** (Slice 4 beat — `DmThreadCreated` event).
4. **Exchange DMs + paste image.** Send 2-3 DMs including a pasted image. Image renders inline, filename preserved.
5. **Ban.** Alice bans Bob user-to-user. Bob's DM composer goes disabled, frozen banner appears, existing history stays visible. Alice unbans — composer re-enables.

*Narration points:*
- DM watermark namespace separate from rooms.
- `dm_threads.frozen_at` is the mechanism for "ban but preserve history" (brief 2.6.4).

---

## Act 5 — Sessions + password (optional, 45s — cut first if running long)

1. **Sessions page.** Alice opens Sessions. Shows two active sessions (both profiles) with browser + IP populated.
2. **Revoke other session.** Alice revokes Bob's session. Within 30 s Bob's next action gets a 401 and redirects to login.
3. **Change password.** Alice changes password. Old password no longer works.

---

## Act 6 — XMPP (P2 — only if Slice 7 shipped)

**If fallback (d) or (d-minus) shipped:**
1. Open Gajim. Show MUC `bridge@conference.chat.local`.
2. Gajim user sends a message in the MUC. **Message appears in Alice's chat-room view within 3 s, badged "via Jabber".**
3. (If bidirectional bridge shipped) Alice replies in-app — Gajim receives the reply.

**If fallback (c) shipped:**
1. Open Gajim, connect to ejabberd. Show the connected state.
2. Second Gajim instance (or second account) joins the MUC. Exchange one message.
3. Narrate: "ejabberd is running alongside our server, brief-literal Jabber connectivity. Bridge into our app was cut at the budget gate — `docs/xmpp-design.md` shows the architecture we would have built."

**If fallback (b) or (a) shipped:**
Skip Act 6 entirely. Cover the design doc verbally during Act 7 close.

---

## Act 7 — Close (30s)

- Call out what's cut and why: federation (scope), admin dashboard (purpose was federation stats), Phase 3 Playwright (manual demo is the safety net).
- Name the Phase 3 thesis in one sentence: *"real-time UX first, then the brief's Jabber surface second, with an explicit fallback ladder so XMPP variance can't eat the demo."*
- Link to `docs/known-bugs.md` and `docs/roadmap.md` for anything not demoed.

---

## Known flakes (update during rehearsal)

*Fill in as rehearsal surfaces flaky steps. Any step listed here is a candidate for cut before the actual demo.*

- (none yet)

## Hard cuts if demo is running long

In order — cut first from the top:

1. Act 5 (sessions + password).
2. Act 3 step 4 (promote/demote/ban — leave only the invitation beat).
3. Act 4 step 5 (DM ban) — keep friend request + open-DM beats.
4. Act 6 (XMPP) — honest cut; pitch as "stretch demo material, happy to show after."
