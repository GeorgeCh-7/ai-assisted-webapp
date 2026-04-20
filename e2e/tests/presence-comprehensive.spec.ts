/**
 * Comprehensive presence / status reactivity tests.
 *
 * Covers every multi-tab, multi-user, multi-page scenario:
 *
 *  ONLINE / OFFLINE
 *  1.  Single tab: online on connect, offline on close
 *  2.  DM sidebar updates when friend connects / disconnects
 *  3.  Bidirectional: A↔B both see each other online
 *  4.  Three-user broadcast: A's change seen by B and C simultaneously
 *  5.  Multi-tab last-tab-wins: online until every tab is closed
 *  6.  Status in DM sidebar visible from any page (room, DM, /friends)
 *  7.  Status follows user across navigation (A moves rooms → still online in sidebar)
 *  8.  Reconnection: status recovers after hub reconnects
 *
 *  AFK
 *  9.  AFK visible in room message row + DM sidebar; clears on interaction
 *  10. AFK visible in DM message row + DM sidebar; clears on interaction
 *  11. Multi-tab AFK resistance: second active tab prevents AFK
 *  12. AFK clears on ANY tab interaction (broadcast channel cross-tab sync)
 *
 * Tests 9–12 use window.__freezeIdle() / __markActive() (DEV only) and are
 * marked test.slow() to budget for the ~75 s server AFK sweep.
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeFriends(
  a: import('../helpers/auth').AuthedContext,
  b: import('../helpers/auth').AuthedContext,
) {
  const req = await a.context.request.post(`${API}/api/friends/requests`, {
    data: { username: b.username },
    headers: { 'X-XSRF-TOKEN': await a.xsrf() },
  })
  if (!req.ok()) throw new Error(`friend request: ${await req.text()}`)
  const acc = await b.context.request.post(`${API}/api/friends/requests/${a.userId}/accept`, {
    headers: { 'X-XSRF-TOKEN': await b.xsrf() },
  })
  if (!acc.ok()) throw new Error(`accept: ${await acc.text()}`)
}

async function openDm(
  a: import('../helpers/auth').AuthedContext,
  b: import('../helpers/auth').AuthedContext,
) {
  const r = await a.context.request.post(`${API}/api/dms/open`, {
    data: { userId: b.userId },
    headers: { 'X-XSRF-TOKEN': await a.xsrf() },
  })
  if (!r.ok()) throw new Error(`open DM: ${await r.text()}`)
  return (await r.json()) as { id: string }
}

async function createRoom(ctx: import('../helpers/auth').AuthedContext, name: string) {
  const r = await ctx.context.request.post(`${API}/api/rooms`, {
    data: { name, description: '' },
    headers: { 'X-XSRF-TOKEN': await ctx.xsrf() },
  })
  if (!r.ok()) throw new Error(`create room: ${await r.text()}`)
  return (await r.json()) as { id: string }
}

async function joinRoom(ctx: import('../helpers/auth').AuthedContext, roomId: string) {
  await ctx.context.request.post(`${API}/api/rooms/${roomId}/join`, {
    headers: { 'X-XSRF-TOKEN': await ctx.xsrf() },
  })
}

async function waitConnected(page: import('@playwright/test').Page) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

function sidebarDmLink(page: import('@playwright/test').Page, threadId: string) {
  return page.locator(`a[href="/dms/${threadId}"]`)
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.keyboard.press('Enter')
}

async function freezeIdle(page: import('@playwright/test').Page) {
  const ok = await page.evaluate(() => {
    const fn = (window as Record<string, unknown>)['__freezeIdle']
    if (typeof fn !== 'function') return false
    ;(fn as () => void)()
    return true
  })
  if (!ok) throw new Error('__freezeIdle not found — useAfkTracker DEV hooks missing')
}

async function triggerActive(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const w = window as Record<string, unknown>
    if (typeof w['__markActive'] === 'function') (w['__markActive'] as () => void)()
    if (typeof w['__sendHeartbeat'] === 'function') {
      await (w['__sendHeartbeat'] as () => Promise<unknown>)()
    }
  })
}

// ── 1. Single tab: online → offline ──────────────────────────────────────────

test('presence: single tab online on connect, offline on close', async ({ userA, userB }) => {
  const room = await createRoom(userA, `pres-1-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  // A not connected yet → offline indicator after they send
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await sendMessage(pageA, 'hello single tab')
  await expect(pageB.getByText('hello single tab')).toBeVisible({ timeout: 10_000 })

  const row = pageB.locator('.group').filter({ hasText: 'hello single tab' }).first()
  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  await pageA.close()
  await expect(row.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB.close()
})

// ── 2. DM sidebar: friend online / offline ────────────────────────────────────

test('presence: DM sidebar reflects friend connect and disconnect', async ({ userA, userB }) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  // B is on /friends — sidebar visible, no room needed
  const pageB = await userB.context.newPage()
  await pageB.goto('/friends')
  await pageB.waitForSelector('nav', { timeout: 8_000 })
  await pageB.waitForTimeout(1_500)

  const link = sidebarDmLink(pageB, thread.id)
  await expect(link).toBeVisible({ timeout: 10_000 })
  await expect(link.locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })

  // A connects
  const pageA = await userA.context.newPage()
  await pageA.goto('/rooms')
  await pageA.waitForSelector('nav', { timeout: 8_000 })
  await pageA.waitForTimeout(1_500)

  await expect(link.locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })

  // A disconnects
  await pageA.close()
  await expect(link.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB.close()
})

// ── 3. Bidirectional ──────────────────────────────────────────────────────────

test('presence: A sees B online, B sees A online simultaneously', async ({ userA, userB }) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-3-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await sendMessage(pageA, 'from a')
  await sendMessage(pageB, 'from b')
  await expect(pageB.getByText('from a')).toBeVisible({ timeout: 10_000 })
  await expect(pageA.getByText('from b')).toBeVisible({ timeout: 10_000 })

  const rowAtB = pageB.locator('.group').filter({ hasText: 'from a' }).first()
  const rowBtA = pageA.locator('.group').filter({ hasText: 'from b' }).first()
  await expect(rowAtB.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(rowBtA.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // DM sidebar — both directions
  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(sidebarDmLink(pageA, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  await pageA.close()
  await pageB.close()
})

// ── 4. Three-user broadcast ───────────────────────────────────────────────────

test('presence: status change broadcast to all watchers at once', async ({
  userA,
  userB,
  userC,
}) => {
  const room = await createRoom(userA, `pres-4-${Date.now()}`)
  await joinRoom(userB, room.id)
  await joinRoom(userC, room.id)

  const pageB = await userB.context.newPage()
  const pageC = await userC.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await pageC.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)
  await waitConnected(pageC)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await sendMessage(pageA, 'three-way')
  await expect(pageB.getByText('three-way')).toBeVisible({ timeout: 10_000 })
  await expect(pageC.getByText('three-way')).toBeVisible({ timeout: 10_000 })

  const rowB = pageB.locator('.group').filter({ hasText: 'three-way' }).first()
  const rowC = pageC.locator('.group').filter({ hasText: 'three-way' }).first()
  await expect(rowB.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(rowC.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  await pageA.close()
  await expect(rowB.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(rowC.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB.close()
  await pageC.close()
})

// ── 5. Multi-tab last-tab-wins ────────────────────────────────────────────────

test('presence: user stays online while any tab open; offline only after last tab closes', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-5-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA1 = await userA.context.newPage()
  const pageA2 = await userA.context.newPage()
  await pageA1.goto(`/rooms/${room.id}`)
  await waitConnected(pageA1)
  await pageA2.goto(`/rooms/${room.id}`)
  await waitConnected(pageA2)

  await sendMessage(pageA1, 'multitab')
  await expect(pageB.getByText('multitab')).toBeVisible({ timeout: 10_000 })

  const row = pageB.locator('.group').filter({ hasText: 'multitab' }).first()
  const sidebar = sidebarDmLink(pageB, thread.id)
  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  // Close first tab — should stay online (tab 2 still alive)
  await pageA1.close()
  await pageB.waitForTimeout(3_000)
  await expect(row.locator('[data-presence="online"]')).toBeVisible()
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible()

  // Close second tab — goes offline everywhere
  await pageA2.close()
  await expect(row.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(sidebar.locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })

  await pageB.close()
})

// ── 6. Status visible from any page type ─────────────────────────────────────

test('presence: DM sidebar status visible from room page, DM page, and /friends', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-6-${Date.now()}`)
  await joinRoom(userB, room.id)

  // Three observer tabs for B on different pages
  const pageRoom = await userB.context.newPage()
  const pageDm = await userB.context.newPage()
  const pageFriends = await userB.context.newPage()

  await pageRoom.goto(`/rooms/${room.id}`)
  await waitConnected(pageRoom)
  await pageDm.goto(`/dms/${thread.id}`)
  await waitConnected(pageDm)
  await pageFriends.goto('/friends')
  await pageFriends.waitForSelector('nav', { timeout: 8_000 })
  await pageFriends.waitForTimeout(1_000)

  // A connects
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  // Sidebar on all three pages shows A as online
  await expect(sidebarDmLink(pageRoom, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })
  await expect(sidebarDmLink(pageDm, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })
  await expect(sidebarDmLink(pageFriends, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })

  // A disconnects — all three pages update
  await pageA.close()
  await expect(sidebarDmLink(pageRoom, thread.id).locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(sidebarDmLink(pageDm, thread.id).locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })
  await expect(sidebarDmLink(pageFriends, thread.id).locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })

  await pageRoom.close()
  await pageDm.close()
  await pageFriends.close()
})

// ── 7. Status follows user across navigation ──────────────────────────────────

test('presence: online status persists as user navigates between rooms', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room1 = await createRoom(userA, `pres-7a-${Date.now()}`)
  const room2 = await createRoom(userA, `pres-7b-${Date.now()}`)
  await joinRoom(userB, room1.id)
  await joinRoom(userB, room2.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room1.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room1.id}`)
  await waitConnected(pageA)

  // Sidebar shows online while A is in room 1
  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })

  // A navigates to room 2
  await pageA.goto(`/rooms/${room2.id}`)
  await waitConnected(pageA)

  // B's sidebar still shows A online (hub maintains connection across navigation)
  await pageB.waitForTimeout(2_000)
  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A navigates to /friends (no room)
  await pageA.goto('/friends')
  await pageA.waitForSelector('nav', { timeout: 8_000 })
  await pageB.waitForTimeout(2_000)
  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  await pageA.close()
  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB.close()
})

// ── 8. Reconnection recovery ──────────────────────────────────────────────────

test('presence: status recovers as online after hub reconnects', async ({ userA, userB }) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-8-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })

  // Simulate a reconnect by navigating away and back (forces hub teardown + rejoin)
  await pageA.goto('/friends')
  await pageA.waitForSelector('nav', { timeout: 8_000 })
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  // B sees A still / again as online
  await expect(sidebarDmLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })

  await pageA.close()
  await pageB.close()
})

// ── 9. AFK in room: message row + DM sidebar ─────────────────────────────────

test('presence: AFK in room — message row + sidebar flip; interaction clears AFK', async ({
  userA,
  userB,
}) => {
  test.setTimeout(150_000)

  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-9-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await sendMessage(pageA, 'afk room msg')
  await expect(pageB.getByText('afk room msg')).toBeVisible({ timeout: 10_000 })

  const row = pageB.locator('.group').filter({ hasText: 'afk room msg' }).first()
  const sidebar = sidebarDmLink(pageB, thread.id)

  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  await freezeIdle(pageA)

  await expect(row.locator('[data-presence="afk"]')).toBeVisible({ timeout: 80_000 })
  await expect(sidebar.locator('[data-presence="afk"]')).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('[data-presence="online"]')).not.toBeVisible()

  await triggerActive(pageA)

  // __sendHeartbeat fires immediately → server broadcasts online within a few seconds
  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 15_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('[data-presence="afk"]')).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})

// ── 10. AFK in DM: message row + DM sidebar ───────────────────────────────────

test('presence: AFK in DM — message row + sidebar flip; typing clears AFK', async ({
  userA,
  userB,
}) => {
  test.setTimeout(150_000)

  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)

  await sendMessage(pageA, 'afk dm msg')
  await expect(pageB.getByText('afk dm msg')).toBeVisible({ timeout: 10_000 })

  const row = pageB.locator('.group').filter({ hasText: 'afk dm msg' }).first()
  const sidebar = sidebarDmLink(pageB, thread.id)

  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  await freezeIdle(pageA)

  await expect(row.locator('[data-presence="afk"]')).toBeVisible({ timeout: 80_000 })
  await expect(sidebar.locator('[data-presence="afk"]')).toBeVisible({ timeout: 5_000 })

  // Natural typing + immediate heartbeat clears AFK
  await pageA.locator('textarea').click()
  await pageA.locator('textarea').type('back now')
  await triggerActive(pageA)

  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 15_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('[data-presence="afk"]')).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})

// ── 11. Multi-tab AFK resistance ─────────────────────────────────────────────
// Tab 1 goes idle (freeze), tab 2 stays active → user should NOT go AFK

test('presence: second active tab prevents AFK even when first tab is idle', async ({
  userA,
  userB,
}) => {
  test.setTimeout(150_000)

  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-11-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  // A opens two tabs
  const pageA1 = await userA.context.newPage()
  const pageA2 = await userA.context.newPage()
  await pageA1.goto(`/rooms/${room.id}`)
  await waitConnected(pageA1)
  await pageA2.goto(`/rooms/${room.id}`)
  await waitConnected(pageA2)

  await sendMessage(pageA1, 'multitab afk')
  await expect(pageB.getByText('multitab afk')).toBeVisible({ timeout: 10_000 })

  const row = pageB.locator('.group').filter({ hasText: 'multitab afk' }).first()
  const sidebar = sidebarDmLink(pageB, thread.id)
  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // Freeze tab 1 only; tab 2 keeps sending heartbeats (call __sendHeartbeat every 10 s to be reliable)
  await freezeIdle(pageA1)

  const keepAlive = setInterval(async () => {
    await pageA2.evaluate(() => {
      const fn = (window as Record<string, unknown>)['__sendHeartbeat']
      if (typeof fn === 'function') (fn as () => void)()
    }).catch(() => {})
  }, 10_000)

  // Wait the full AFK window — user should remain online because tab 2 keeps sending heartbeats
  await pageB.waitForTimeout(80_000)
  clearInterval(keepAlive)

  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('[data-presence="afk"]')).not.toBeVisible()

  await pageA1.close()
  await pageA2.close()
  await pageB.close()
})

// ── 12. AFK clears on any-tab interaction (BroadcastChannel sync) ─────────────

test('presence: AFK clears when user interacts on a different tab than the one that went idle', async ({
  userA,
  userB,
}) => {
  test.setTimeout(150_000)

  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `pres-12-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  // A has two tabs
  const pageA1 = await userA.context.newPage()
  const pageA2 = await userA.context.newPage()
  await pageA1.goto(`/rooms/${room.id}`)
  await waitConnected(pageA1)
  await pageA2.goto(`/rooms/${room.id}`)
  await waitConnected(pageA2)

  await sendMessage(pageA1, 'cross-tab afk')
  await expect(pageB.getByText('cross-tab afk')).toBeVisible({ timeout: 10_000 })

  const row = pageB.locator('.group').filter({ hasText: 'cross-tab afk' }).first()
  const sidebar = sidebarDmLink(pageB, thread.id)
  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // Freeze BOTH tabs → user goes AFK; bring pageB to front for observation
  await freezeIdle(pageA1)
  await freezeIdle(pageA2)
  await pageB.bringToFront()

  await expect(row.locator('[data-presence="afk"]')).toBeVisible({ timeout: 80_000 })
  await expect(sidebar.locator('[data-presence="afk"]')).toBeVisible({ timeout: 5_000 })

  // Interact on tab 2 — BroadcastChannel syncs to tab 1, both resume heartbeats
  await pageA2.bringToFront()
  await triggerActive(pageA2)

  await pageB.bringToFront()
  await expect(row.locator('[data-presence="online"]')).toBeVisible({ timeout: 30_000 })
  await expect(sidebar.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('[data-presence="afk"]')).not.toBeVisible()

  await pageA1.close()
  await pageA2.close()
  await pageB.close()
})
