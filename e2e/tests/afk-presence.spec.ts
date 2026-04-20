/**
 * AFK + multi-tab presence tests
 *
 * Covers:
 *  1. Bidirectional online: A sees B online, B sees A online; also in DM sidebar
 *  2. Multi-tab: user stays online while any tab is open; offline only when last tab closes
 *  3. Three-user broadcast: status change seen by all watchers at once
 *  4. AFK transition (room): user goes AFK after idle; DM sidebar + message row both flip;
 *     interaction brings them back online
 *  5. AFK transition (DM): same checks inside a DM thread window
 *
 * Tests 4 & 5 use window.__freezeIdle() / window.__markActive() hooks (DEV only) so we
 * don't have to wait 5-min client idle + 60 s server sweep in CI.
 * Both are marked test.slow() (3× default timeout) to budget for the ~75 s server sweep.
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

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

function dmSidebarLink(page: import('@playwright/test').Page, threadId: string) {
  return page.locator(`a[href="/dms/${threadId}"]`)
}

// ── Test 1: Bidirectional online ──────────────────────────────────────────────

test('afk: both users see each other online — message row + DM sidebar', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `afk-bidir-${Date.now()}`)
  await joinRoom(userB, room.id)

  // B connects first (so it receives A's online broadcast)
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  // Each sends a message so their row is visible to the other
  await pageA.locator('textarea').fill('bidir check')
  await pageA.keyboard.press('Enter')
  await expect(pageB.getByText('bidir check')).toBeVisible({ timeout: 10_000 })

  await pageB.locator('textarea').fill('bidir reply')
  await pageB.keyboard.press('Enter')
  await expect(pageA.getByText('bidir reply')).toBeVisible({ timeout: 10_000 })

  // Message row presence
  const msgRowA = pageA.locator('.group').filter({ hasText: 'bidir reply' }).first()
  const msgRowB = pageB.locator('.group').filter({ hasText: 'bidir check' }).first()
  await expect(msgRowA.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(msgRowB.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // DM sidebar presence (B's sidebar shows A; A's sidebar shows B)
  await expect(dmSidebarLink(pageB, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(dmSidebarLink(pageA, thread.id).locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A disconnects — B sees offline in both places
  await pageA.close()
  await expect(msgRowB.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(dmSidebarLink(pageB, thread.id).locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })

  await pageB.close()
})

// ── Test 2: Multi-tab — stays online until last tab closes ────────────────────

test('afk: user stays online while any tab open; offline only when last tab closes', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `afk-multitab-${Date.now()}`)
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

  await pageA1.locator('textarea').fill('multitab msg')
  await pageA1.keyboard.press('Enter')
  await expect(pageB.getByText('multitab msg')).toBeVisible({ timeout: 10_000 })

  const msgRow = pageB.locator('.group').filter({ hasText: 'multitab msg' }).first()
  const sidebarLink = dmSidebarLink(pageB, thread.id)
  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(sidebarLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  // Close tab 1 — A still has tab 2 open → should remain online
  await pageA1.close()
  await pageB.waitForTimeout(3_000)
  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(sidebarLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(msgRow.locator('[data-presence="offline"]')).not.toBeVisible()

  // Close tab 2 — last connection gone → A goes offline in both places
  await pageA2.close()
  await expect(msgRow.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(sidebarLink.locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })
  await expect(msgRow.locator('[data-presence="online"]')).not.toBeVisible()

  await pageB.close()
})

// ── Test 3: Three-user broadcast ──────────────────────────────────────────────

test('afk: status change seen by multiple watchers simultaneously', async ({
  userA,
  userB,
  userC,
}) => {
  const room = await createRoom(userA, `afk-three-${Date.now()}`)
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

  await pageA.locator('textarea').fill('three-way msg')
  await pageA.keyboard.press('Enter')
  await expect(pageB.getByText('three-way msg')).toBeVisible({ timeout: 10_000 })
  await expect(pageC.getByText('three-way msg')).toBeVisible({ timeout: 10_000 })

  const rowB = pageB.locator('.group').filter({ hasText: 'three-way msg' }).first()
  const rowC = pageC.locator('.group').filter({ hasText: 'three-way msg' }).first()
  await expect(rowB.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(rowC.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A disconnects — both B and C see offline
  await pageA.close()
  await expect(rowB.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(rowC.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB.close()
  await pageC.close()
})

// ── Test 4: AFK transition (room + DM sidebar) ────────────────────────────────

test('afk: user goes AFK when idle — message row + DM sidebar both flip; returns online on interaction', async ({
  userA,
  userB,
}) => {
  test.slow()

  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)
  const room = await createRoom(userA, `afk-idle-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await pageA.locator('textarea').fill('afk test msg')
  await pageA.keyboard.press('Enter')
  await expect(pageB.getByText('afk test msg')).toBeVisible({ timeout: 10_000 })

  const msgRow = pageB.locator('.group').filter({ hasText: 'afk test msg' }).first()
  const sidebarLink = dmSidebarLink(pageB, thread.id)

  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(sidebarLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  // Freeze A's idle clock → client stops sending heartbeats immediately
  await pageA.evaluate(() => {
    const fn = (window as Record<string, unknown>)['__freezeIdle']
    if (typeof fn === 'function') fn()
  })

  // Server AFK sweeper detects missing heartbeats → broadcasts AFK
  await expect(msgRow.locator('[data-presence="afk"]')).toBeVisible({ timeout: 80_000 })
  await expect(sidebarLink.locator('[data-presence="afk"]')).toBeVisible({ timeout: 5_000 })
  await expect(msgRow.locator('[data-presence="online"]')).not.toBeVisible()
  await expect(sidebarLink.locator('[data-presence="online"]')).not.toBeVisible()

  // A interacts → immediate heartbeat → back to online in both places
  await pageA.evaluate(() => {
    const w = window as Record<string, unknown>
    if (typeof w['__markActive'] === 'function') (w['__markActive'] as () => void)()
    if (typeof w['__sendHeartbeat'] === 'function') (w['__sendHeartbeat'] as () => void)()
  })

  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 20_000 })
  await expect(sidebarLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(msgRow.locator('[data-presence="afk"]')).not.toBeVisible()
  await expect(sidebarLink.locator('[data-presence="afk"]')).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})

// ── Test 5: AFK in DM thread + sidebar ───────────────────────────────────────

test('afk: AFK visible in DM message row + sidebar, clears on re-engagement', async ({
  userA,
  userB,
}) => {
  test.slow()

  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  // B connects first — also open the /friends page in a separate tab so sidebar is visible
  const pageB = await userB.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)

  await pageA.locator('textarea').fill('dm afk test')
  await pageA.keyboard.press('Enter')
  await expect(pageB.getByText('dm afk test')).toBeVisible({ timeout: 10_000 })

  const msgRow = pageB.locator('.group').filter({ hasText: 'dm afk test' }).first()
  const sidebarLink = dmSidebarLink(pageB, thread.id)

  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })
  await expect(sidebarLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })

  // Freeze A
  await pageA.evaluate(() => {
    const fn = (window as Record<string, unknown>)['__freezeIdle']
    if (typeof fn === 'function') fn()
  })

  await expect(msgRow.locator('[data-presence="afk"]')).toBeVisible({ timeout: 80_000 })
  await expect(sidebarLink.locator('[data-presence="afk"]')).toBeVisible({ timeout: 5_000 })

  // A types in the DM composer — natural interaction resets idle clock
  await pageA.locator('textarea').click()
  await pageA.locator('textarea').type('coming back')

  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 20_000 })
  await expect(sidebarLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 5_000 })
  await expect(msgRow.locator('[data-presence="afk"]')).not.toBeVisible()
  await expect(sidebarLink.locator('[data-presence="afk"]')).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})
