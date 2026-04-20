/**
 * Multi-user presence + real-time notification tests.
 *
 * Scenarios:
 *  1. Presence goes online → offline when user closes their tab
 *  2. Presence stays online while user has multiple tabs; goes offline only when all close
 *  3. Friend request badge appears without refresh
 *  4. Room invitation bell badge appears without refresh; accept flow works
 *  5. New public room appears in catalog within 3s of creation
 *  6. DM thread appears in Alice's sidebar without refresh after Bob initiates
 *  7. 3 rapid messages arrive in send order, no duplicates (both directions)
 *  8. DM unread badge increments without refresh
 *  9. Room unread badge increments when recipient is not in the room
 */

import { test, expect } from '@playwright/test'
import { createAuthedContext, uniqueUser, API } from '../helpers/auth'
import type { AuthedContext } from '../helpers/auth'

// ---------- helpers ----------

const openContexts: AuthedContext[] = []

test.afterEach(async () => {
  await Promise.all(openContexts.map(c => c.context.close().catch(() => {})))
  openContexts.length = 0
})

async function user(browser: Parameters<typeof createAuthedContext>[0], prefix: string) {
  const ctx = await createAuthedContext(browser, uniqueUser(prefix))
  openContexts.push(ctx)
  return ctx
}

// Only ChatWindow renders span[title="Connected"]. For non-room pages use networkidle + SignalR grace.
async function waitConnected(page: Parameters<typeof expect>[0]) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

async function waitPageReady(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 })
  // Wait for nav to confirm app hydrated, then allow SignalR handshake
  await page.waitForSelector('nav', { timeout: 5_000 })
  await page.waitForTimeout(2_500)
}

async function sendFriendRequest(from: AuthedContext, toUsername: string) {
  const r = await from.context.request.post(`${API}/api/friends/requests`, {
    data: { username: toUsername },
    headers: { 'X-XSRF-TOKEN': await from.xsrf() },
  })
  if (!r.ok()) throw new Error(`sendFriendRequest failed ${r.status()}: ${await r.text()}`)
}

async function makeFriends(a: AuthedContext, b: AuthedContext) {
  const reqResp = await a.context.request.post(`${API}/api/friends/requests`, {
    data: { username: b.username },
    headers: { 'X-XSRF-TOKEN': await a.xsrf() },
  })
  if (!reqResp.ok()) throw new Error(`sendFriendRequest failed ${reqResp.status()}: ${await reqResp.text()}`)
  // Accept endpoint uses sender's userId, not a request ID
  const accept = await b.context.request.post(`${API}/api/friends/requests/${a.userId}/accept`, {
    headers: { 'X-XSRF-TOKEN': await b.xsrf() },
  })
  if (!accept.ok()) throw new Error(`acceptFriendRequest failed ${accept.status()}: ${await accept.text()}`)
}

async function createRoom(ctx: AuthedContext, name: string, isPrivate = false) {
  const r = await ctx.context.request.post(`${API}/api/rooms`, {
    data: { name, description: '', isPrivate },
    headers: { 'X-XSRF-TOKEN': await ctx.xsrf() },
  })
  return (await r.json()) as { id: string; name: string }
}

async function joinRoom(ctx: AuthedContext, roomId: string) {
  await ctx.context.request.post(`${API}/api/rooms/${roomId}/join`, {
    headers: { 'X-XSRF-TOKEN': await ctx.xsrf() },
  })
}

async function openDmThread(a: AuthedContext, b: AuthedContext) {
  const r = await a.context.request.post(`${API}/api/dms/open`, {
    data: { userId: b.userId },
    headers: { 'X-XSRF-TOKEN': await a.xsrf() },
  })
  if (!r.ok()) throw new Error(`openDmThread failed ${r.status()}: ${await r.text()}`)
  return (await r.json()) as { id: string }
}

// ---------- tests ----------

test('1 — presence goes online then offline when user closes tab', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  const room = await createRoom(alice, `pres-1-${Date.now()}`)
  await joinRoom(bob, room.id)

  const pageA = await alice.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  const pageB = await bob.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  // Bob sends a message so his presence indicator appears in Alice's view
  await pageB.locator('textarea').fill('hello from bob')
  await pageB.keyboard.press('Enter')
  await expect(pageA.getByText('hello from bob')).toBeVisible({ timeout: 8_000 })

  // Alice sees Bob as online
  await expect(pageA.locator('[data-presence="online"]').first()).toBeVisible({ timeout: 5_000 })

  // Bob closes his tab
  await pageB.close()

  // Alice sees Bob go offline within 35s (heartbeat interval + grace)
  await expect(pageA.locator('[data-presence="offline"]').first()).toBeVisible({ timeout: 35_000 })

  await pageA.close()
})

test('2 — presence stays online with two tabs; goes offline only when both close', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  const room = await createRoom(alice, `pres-2-${Date.now()}`)
  await joinRoom(bob, room.id)

  const pageA = await alice.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  // Bob opens two tabs
  const pageB1 = await bob.context.newPage()
  const pageB2 = await bob.context.newPage()
  await pageB1.goto(`/rooms/${room.id}`)
  await pageB2.goto(`/rooms/${room.id}`)
  await waitConnected(pageB1)
  await waitConnected(pageB2)

  // Bob sends from first tab so indicator appears in Alice's view
  await pageB1.locator('textarea').fill('two-tab test')
  await pageB1.keyboard.press('Enter')
  await expect(pageA.getByText('two-tab test')).toBeVisible({ timeout: 8_000 })
  await expect(pageA.locator('[data-presence="online"]').first()).toBeVisible({ timeout: 5_000 })

  // Bob closes first tab — second tab still open → should stay online
  await pageB1.close()
  // Wait 4s and assert still online (negative temporal assertion — no event-based alternative)
  await pageA.waitForTimeout(4_000)
  const offlineCount = await pageA.locator('[data-presence="offline"]').count()
  expect(offlineCount, 'Bob should still be online while second tab is open').toBe(0)

  // Bob closes second tab — now truly offline
  await pageB2.close()
  await expect(pageA.locator('[data-presence="offline"]').first()).toBeVisible({ timeout: 35_000 })

  await pageA.close()
})

test('3 — friend request badge appears on /friends without refresh', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')

  // Alice opens /friends
  const pageA = await alice.context.newPage()
  await pageA.goto('/friends')
  await waitPageReady(pageA)

  // Bob sends a friend request to Alice via API
  await sendFriendRequest(bob, alice.username)

  // Alice's contacts badge — absolute span inside the Button wrapping the /friends Link
  // The Button has class "relative"; the span is positioned -top-0.5 -right-0.5 inside it
  const contactsBadge = pageA.locator('a[href="/friends"]').locator('span.bg-emerald-500')
  await expect(contactsBadge).toBeVisible({ timeout: 10_000 })

  await pageA.close()
})

test('4 — room invitation bell badge appears without refresh; accept joins room', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  const room = await createRoom(alice, `inv-4-${Date.now()}`, true)

  // Bob opens rooms catalog (any page with the nav)
  const pageB = await bob.context.newPage()
  await pageB.goto('/rooms')
  await waitPageReady(pageB)

  // Alice invites Bob via API
  await alice.context.request.post(`${API}/api/rooms/${room.id}/invitations`, {
    data: { username: bob.username },
    headers: { 'X-XSRF-TOKEN': await alice.xsrf() },
  })

  // Bell badge should appear within 5s
  const bellBadge = pageB.locator('nav button').filter({ has: pageB.locator('span.bg-emerald-500') }).first()
  await expect(bellBadge).toBeVisible({ timeout: 5_000 })

  // Click bell to open invitation modal and accept
  await bellBadge.click()
  await pageB.getByRole('button', { name: /accept/i }).first().click()

  // Bob should now see the private room accessible (navigates to room or catalog shows it)
  await expect(pageB.locator(`a[href="/rooms/${room.id}"]`).first()).toBeVisible({ timeout: 8_000 })

  await pageB.close()
})

test('5 — new public room appears in catalog within 3s without refresh', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')

  // Bob watches the catalog
  const pageB = await bob.context.newPage()
  await pageB.goto('/rooms')
  await waitPageReady(pageB)

  const roomName = `live-room-${Date.now()}`

  // Alice creates a public room
  await createRoom(alice, roomName, false)

  // Bob should see it within 3s
  await expect(pageB.getByText(roomName)).toBeVisible({ timeout: 3_000 })

  await pageB.close()
})

test('6 — DM thread appears in Alice sidebar without refresh after Bob initiates', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  await makeFriends(alice, bob)

  // Alice watches /dms page (sidebar)
  const pageA = await alice.context.newPage()
  await pageA.goto('/dms')
  await waitPageReady(pageA)

  // Bob creates a DM thread with Alice and sends a message
  const thread = await openDmThread(bob, alice)
  const pageB = await bob.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)
  await pageB.locator('textarea').fill('hey alice')
  await pageB.keyboard.press('Enter')

  // Alice's sidebar should show the DM thread link within 5s
  await expect(pageA.locator(`a[href="/dms/${thread.id}"]`)).toBeVisible({ timeout: 5_000 })

  await pageA.close()
  await pageB.close()
})

test('7 — 3 rapid messages arrive in send order, no duplicates', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  const room = await createRoom(alice, `order-7-${Date.now()}`)
  await joinRoom(bob, room.id)

  const pageA = await alice.context.newPage()
  const pageB = await bob.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  // Alice sends 3 messages in rapid succession
  for (const msg of ['msg-one', 'msg-two', 'msg-three']) {
    await pageA.locator('textarea').fill(msg)
    await pageA.keyboard.press('Enter')
  }

  // Bob sees all 3
  await expect(pageB.getByText('msg-one')).toBeVisible({ timeout: 10_000 })
  await expect(pageB.getByText('msg-two')).toBeVisible({ timeout: 5_000 })
  await expect(pageB.getByText('msg-three')).toBeVisible({ timeout: 5_000 })

  // Verify order by Y position (earlier message = higher on screen = smaller Y)
  const y = async (text: string) =>
    (await pageB.getByText(text).first().boundingBox())?.y ?? Infinity
  expect(await y('msg-one')).toBeLessThan(await y('msg-two'))
  expect(await y('msg-two')).toBeLessThan(await y('msg-three'))

  // Verify no duplicates — each text appears exactly once
  for (const msg of ['msg-one', 'msg-two', 'msg-three']) {
    expect(await pageB.getByText(msg).count()).toBe(1)
  }

  // Reverse direction: Bob sends 3 back
  for (const msg of ['reply-one', 'reply-two', 'reply-three']) {
    await pageB.locator('textarea').fill(msg)
    await pageB.keyboard.press('Enter')
  }
  await expect(pageA.getByText('reply-one')).toBeVisible({ timeout: 10_000 })
  await expect(pageA.getByText('reply-two')).toBeVisible({ timeout: 5_000 })
  await expect(pageA.getByText('reply-three')).toBeVisible({ timeout: 5_000 })

  const ya = async (text: string) =>
    (await pageA.getByText(text).first().boundingBox())?.y ?? Infinity
  expect(await ya('reply-one')).toBeLessThan(await ya('reply-two'))
  expect(await ya('reply-two')).toBeLessThan(await ya('reply-three'))

  await pageA.close()
  await pageB.close()
})

test('8 — DM unread badge increments without refresh', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  await makeFriends(alice, bob)

  // Bob opens a DM thread with Alice
  const thread = await openDmThread(bob, alice)

  // Alice navigates somewhere other than the DM thread (catalog)
  const pageA = await alice.context.newPage()
  await pageA.goto('/rooms')
  await waitPageReady(pageA)

  // Bob sends a message
  const pageB = await bob.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)
  await pageB.locator('textarea').fill('unread test message')
  await pageB.keyboard.press('Enter')

  // Alice's DM sidebar badge should appear within 5s
  const dmBadge = pageA.locator(`a[href="/dms/${thread.id}"] .bg-sky-500`)
  await expect(dmBadge).toBeVisible({ timeout: 5_000 })

  await pageA.close()
  await pageB.close()
})

test('9 — room unread badge increments when Alice is not in the room', async ({ browser }) => {
  const alice = await user(browser, 'a')
  const bob = await user(browser, 'b')
  const room = await createRoom(alice, `unread-9-${Date.now()}`)
  await joinRoom(bob, room.id)

  // Alice watches the catalog (not inside the room)
  const pageA = await alice.context.newPage()
  await pageA.goto('/rooms')
  await waitPageReady(pageA)

  // Bob opens the room and sends a message
  const pageB = await bob.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)
  await pageB.locator('textarea').fill('room unread test')
  await pageB.keyboard.press('Enter')

  // Alice's catalog should show an unread badge on the room within 5s.
  // The catalog room name link has .truncate (sidebar/button links don't) — use it to
  // scope the search to the catalog row and avoid strict-mode violations.
  const catalogRoomRow = pageA.locator('div').filter({
    has: pageA.locator(`a[href="/rooms/${room.id}"].truncate`),
  })
  const unreadBadge = catalogRoomRow.locator('.bg-emerald-500').first()
  await expect(unreadBadge).toBeVisible({ timeout: 8_000 })

  await pageA.close()
  await pageB.close()
})
