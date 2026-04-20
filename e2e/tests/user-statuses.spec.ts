/**
 * User status (presence) e2e tests.
 *
 * Covers:
 *  1. DM sidebar: friend appears online when they connect, offline when they disconnect
 *  2. Room message list: sender's indicator is online; goes offline when they close
 *  3. Room member list refreshes when a user joins / leaves
 *  4. Status visible in both rooms if users share multiple rooms
 *
 * AFK (60 s idle threshold) is not tested here — it requires a 75+ second wait
 * which is too slow for CI. The AFK sweeper logic is covered by the backend unit tests.
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

async function createRoom(
  ctx: import('../helpers/auth').AuthedContext,
  name: string,
) {
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

// ── Test 1: DM sidebar presence ───────────────────────────────────────────────

test('status: friend shows online in DM sidebar when connected, offline when disconnected', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  // B lands on /friends — sidebar is visible, hub is connected
  const pageB = await userB.context.newPage()
  await pageB.goto('/friends')
  // Wait for app to hydrate and hub to connect (no Connected indicator on this page)
  await pageB.waitForSelector('nav', { timeout: 8_000 })
  await pageB.waitForTimeout(2_000)

  const dmLink = pageB.locator(`a[href="/dms/${thread.id}"]`)
  await expect(dmLink).toBeVisible({ timeout: 10_000 })

  // A is not yet connected — should show offline
  await expect(dmLink.locator('[data-presence="offline"]')).toBeVisible({ timeout: 5_000 })

  // A opens the app → hub connects → PresenceChanged {online} fires to B via user-{B} group
  const pageA = await userA.context.newPage()
  await pageA.goto('/rooms')
  await pageA.waitForSelector('nav', { timeout: 8_000 })
  await pageA.waitForTimeout(1_500)

  // B's DM sidebar should now show A as online
  await expect(dmLink.locator('[data-presence="online"]')).toBeVisible({ timeout: 10_000 })
  await expect(dmLink.locator('[data-presence="offline"]')).not.toBeVisible()

  // A disconnects
  await pageA.close()

  // B sees A go offline
  await expect(dmLink.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(dmLink.locator('[data-presence="online"]')).not.toBeVisible()

  await pageB.close()
})

// ── Test 2: Room message-row presence indicator ───────────────────────────────

test('status: sender appears online next to their message, offline when they close', async ({
  userA,
  userB,
}) => {
  const room = await createRoom(userA, `status-msg-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  // A sends a message so their row appears in B's view
  await pageA.locator('textarea').fill('status check msg')
  await pageA.keyboard.press('Enter')
  await expect(pageB.getByText('status check msg')).toBeVisible({ timeout: 10_000 })

  // B sees A as online next to that message
  const msgRow = pageB.locator('.group').filter({ hasText: 'status check msg' }).first()
  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A closes — offline event fires
  await pageA.close()
  await expect(msgRow.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(msgRow.locator('[data-presence="online"]')).not.toBeVisible()

  await pageB.close()
})

// ── Test 3: Room member count updates dynamically ─────────────────────────────

test('status: room member list updates when a user joins without refresh', async ({
  userA,
  userB,
}) => {
  const room = await createRoom(userA, `status-members-${Date.now()}`)

  // A is in the room, B has NOT joined yet
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  // The room header renders: <Users icon> {memberCount} in a span — just the raw number, no "member" label.
  // Find the span that wraps an SVG (the Users icon) and whose text is only digits.
  const memberCountSpan = pageA.locator('span').filter({ has: pageA.locator('svg') }).filter({ hasText: /^\s*\d+\s*$/ })
  await expect(memberCountSpan).toContainText('1', { timeout: 8_000 })

  // B joins via API (simulates B clicking Join in another tab)
  await joinRoom(userB, room.id)

  // B then opens the room (triggers UserJoinedRoom SignalR event → room query invalidated)
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageB)

  // A's view updates to show 2 members without refresh
  await expect(memberCountSpan).toContainText('2', { timeout: 10_000 })

  await pageA.close()
  await pageB.close()
})

// ── Test 4: Presence works across shared rooms ────────────────────────────────

test('status: user online status visible in both shared rooms simultaneously', async ({
  userA,
  userB,
}) => {
  const room1 = await createRoom(userA, `status-r1-${Date.now()}`)
  const room2 = await createRoom(userA, `status-r2-${Date.now()}`)
  await joinRoom(userB, room1.id)
  await joinRoom(userB, room2.id)

  // B watches both rooms in separate pages
  const pageB1 = await userB.context.newPage()
  const pageB2 = await userB.context.newPage()
  await pageB1.goto(`/rooms/${room1.id}`)
  await pageB2.goto(`/rooms/${room2.id}`)
  await waitConnected(pageB1)
  await waitConnected(pageB2)

  // A joins room1, sends message (so row appears), then switches to room2
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room1.id}`)
  await waitConnected(pageA)
  await pageA.locator('textarea').fill('hello from room1')
  await pageA.keyboard.press('Enter')
  await expect(pageB1.getByText('hello from room1')).toBeVisible({ timeout: 10_000 })

  // B1 sees A as online
  const msgRow1 = pageB1.locator('.group').filter({ hasText: 'hello from room1' }).first()
  await expect(msgRow1.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A navigates to room2 and sends a message there
  await pageA.goto(`/rooms/${room2.id}`)
  await waitConnected(pageA)
  await pageA.locator('textarea').fill('hello from room2')
  await pageA.keyboard.press('Enter')
  await expect(pageB2.getByText('hello from room2')).toBeVisible({ timeout: 10_000 })

  // B2 sees A as online in room2
  const msgRow2 = pageB2.locator('.group').filter({ hasText: 'hello from room2' }).first()
  await expect(msgRow2.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A closes — both rooms see offline
  await pageA.close()
  await expect(msgRow1.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })
  await expect(msgRow2.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB1.close()
  await pageB2.close()
})

// ── Test 5: Status in DM thread window ───────────────────────────────────────

test('status: DM window shows correct presence for partner during conversation', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  // B connects FIRST so it receives A's PresenceChanged {online} event when A connects.
  // If A connected first, B would miss the broadcast (hub not yet listening).
  const pageB = await userB.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)

  // A sends a message; B sees A's indicator as online next to the message
  await pageA.locator('textarea').fill('dm status check')
  await pageA.keyboard.press('Enter')
  await expect(pageB.getByText('dm status check')).toBeVisible({ timeout: 10_000 })

  const msgRow = pageB.locator('.group').filter({ hasText: 'dm status check' }).first()
  await expect(msgRow.locator('[data-presence="online"]')).toBeVisible({ timeout: 8_000 })

  // A closes → B sees offline
  await pageA.close()
  await expect(msgRow.locator('[data-presence="offline"]')).toBeVisible({ timeout: 15_000 })

  await pageB.close()
})
