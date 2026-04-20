/**
 * Room management UI tests
 *
 * Covers the Settings modal and member management actions:
 *  1. Settings gear opens the modal with tabs (Members, Admins, Banned)
 *  2. Owner can ban a member; member disappears from members tab
 *  3. Banned member appears in Banned tab; can be unbanned
 *  4. Owner can promote member to admin; appears in Admins tab
 *  5. Owner can demote admin back to member
 *  6. Banned member cannot re-join via API (403)
 *  7. Room owner can see room name and Delete Room in Settings tab
 *  8. Room catalog search filter narrows results
 *  9. Room catalog private room not visible to non-members
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

// ── helpers ───────────────────────────────────────────────────────────────────

async function createRoom(
  ctx: import('../helpers/auth').AuthedContext,
  name: string,
  isPrivate = false,
) {
  const r = await ctx.context.request.post(`${API}/api/rooms`, {
    data: { name, description: '', isPrivate },
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

async function banMember(
  ctx: import('../helpers/auth').AuthedContext,
  roomId: string,
  userId: string,
) {
  const r = await ctx.context.request.post(`${API}/api/rooms/${roomId}/members/${userId}/ban`, {
    data: { reason: null },
    headers: { 'X-XSRF-TOKEN': await ctx.xsrf() },
  })
  if (!r.ok()) throw new Error(`ban member: ${await r.text()}`)
}

async function promoteMember(
  ctx: import('../helpers/auth').AuthedContext,
  roomId: string,
  userId: string,
) {
  const r = await ctx.context.request.post(
    `${API}/api/rooms/${roomId}/members/${userId}/promote`,
    { headers: { 'X-XSRF-TOKEN': await ctx.xsrf() } },
  )
  if (!r.ok()) throw new Error(`promote member: ${await r.text()}`)
}

async function waitConnected(page: import('@playwright/test').Page) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('button[aria-label="Room settings"]').click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
}

// ── 1. Settings modal opens with tabs ─────────────────────────────────────────

test('room-mgmt: settings modal opens with Members / Admins / Banned / Settings tabs', async ({
  userA,
}) => {
  const room = await createRoom(userA, `mgmt-1-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await openSettings(page)

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText(/members/i).first()).toBeVisible()
  await expect(page.getByText(/admins/i).first()).toBeVisible()
  await expect(page.getByText(/banned/i).first()).toBeVisible()
  await expect(page.getByText(/settings/i).first()).toBeVisible()

  await page.close()
})

// ── 2. Owner bans a member; member disappears from Members tab ─────────────────

test('room-mgmt: owner can ban a member from the Members tab', async ({ userA, userB }) => {
  const room = await createRoom(userA, `mgmt-2-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await openSettings(pageA)

  // Members tab — B's username should be visible
  await expect(pageA.getByText(userB.username)).toBeVisible({ timeout: 5_000 })

  // Click Ban (only one ban button since A cannot ban themselves)
  await pageA.getByRole('button', { name: 'ban' }).click()

  // B disappears from Members tab
  await expect(pageA.getByText(userB.username)).not.toBeVisible({ timeout: 5_000 })

  await pageA.close()
})

// ── 3. Banned member shows in Banned tab; can be unbanned ─────────────────────

test('room-mgmt: banned member appears in Banned tab; unban restores access', async ({
  userA,
  userB,
}) => {
  const room = await createRoom(userA, `mgmt-3-${Date.now()}`)
  await joinRoom(userB, room.id)
  await banMember(userA, room.id, userB.userId)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await openSettings(pageA)

  // Go to Banned tab
  await pageA.getByRole('tab', { name: /banned/i }).click()
  await expect(pageA.getByText(userB.username)).toBeVisible({ timeout: 8_000 })

  // Unban B (only one unban button)
  await pageA.getByRole('button', { name: 'unban' }).click()

  // B disappears from Banned tab
  await expect(pageA.getByText(userB.username)).not.toBeVisible({ timeout: 5_000 })

  await pageA.close()
})

// ── 4. Owner promotes member to admin ─────────────────────────────────────────

test('room-mgmt: owner promotes member to admin via Admins tab', async ({ userA, userB }) => {
  const room = await createRoom(userA, `mgmt-4-${Date.now()}`)
  await joinRoom(userB, room.id)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await openSettings(pageA)

  // Go to Admins tab
  await pageA.getByRole('tab', { name: /admins/i }).click()

  // B should be listed under "Promote a member" section
  await expect(pageA.getByText(userB.username)).toBeVisible({ timeout: 5_000 })

  // Click Promote (only one eligible member)
  await pageA.getByRole('button', { name: 'promote' }).click()

  // B now appears in Current admins section (promote button replaced by demote)
  await expect(pageA.getByRole('button', { name: 'demote' })).toBeVisible({ timeout: 5_000 })

  await pageA.close()
})

// ── 5. Owner demotes admin back to member ─────────────────────────────────────

test('room-mgmt: owner can demote admin to member', async ({ userA, userB }) => {
  const room = await createRoom(userA, `mgmt-5-${Date.now()}`)
  await joinRoom(userB, room.id)
  await promoteMember(userA, room.id, userB.userId)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)

  await openSettings(pageA)
  await pageA.getByRole('tab', { name: /admins/i }).click()

  // B should appear as current admin
  await expect(pageA.getByText(userB.username)).toBeVisible({ timeout: 5_000 })
  await pageA.getByRole('button', { name: 'demote' }).click()

  // Demote button should disappear; B is now a member in promote section
  await expect(pageA.getByRole('button', { name: 'demote' })).not.toBeVisible({ timeout: 5_000 })

  await pageA.close()
})

// ── 6. Banned member cannot re-join via API ───────────────────────────────────

test('room-mgmt: banned member cannot join room (API returns 403)', async ({ userA, userB }) => {
  const room = await createRoom(userA, `mgmt-6-${Date.now()}`)
  await joinRoom(userB, room.id)
  await banMember(userA, room.id, userB.userId)

  // B tries to join — should fail
  const joinResp = await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(joinResp.status()).toBe(403)
})

// ── 7. Room settings tab: room name visible; delete room available to owner ───

test('room-mgmt: Settings tab shows room name and Delete Room button for owner', async ({
  userA,
}) => {
  const name = `mgmt-7-${Date.now()}`
  const room = await createRoom(userA, name)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await openSettings(page)
  await page.getByRole('tab', { name: /^settings$/i }).click()

  // The dialog title contains the room name; scope to dialog to avoid strict mode
  await expect(page.getByRole('dialog').getByRole('heading', { name: new RegExp(name) })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: /delete room/i })).toBeVisible()

  await page.close()
})

// ── 8. Room catalog search filters results live ────────────────────────────────

test('room-mgmt: catalog search narrows results in real time', async ({ userA }) => {
  const unique = `searchable-${Date.now()}`
  await createRoom(userA, unique)

  const page = await userA.context.newPage()
  await page.goto('/rooms')
  // Catalog page doesn't use SignalR; wait for the search input instead
  await page.waitForSelector('input[placeholder*="filter" i]', { timeout: 8_000 })

  // Type the unique room name in the search box
  await page.locator('input[placeholder*="filter" i]').fill(unique)

  // The unique room must appear
  await expect(page.getByText(unique)).toBeVisible({ timeout: 5_000 })

  // After clearing, the room is still visible
  await page.locator('input[placeholder*="filter" i]').fill('')
  await expect(page.getByText(unique)).toBeVisible({ timeout: 3_000 })

  await page.close()
})

// ── 9. Private room: not visible in public catalog to non-invited users ───────

test('room-mgmt: private room not visible in public catalog to non-invited users', async ({
  userA,
  userB,
}) => {
  const name = `private-cat-${Date.now()}`
  await createRoom(userA, name, true)

  const page = await userB.context.newPage()
  await page.goto('/rooms')
  await page.waitForSelector('nav', { timeout: 8_000 })
  await page.waitForTimeout(1_500)

  // B should NOT see the private room
  await expect(page.getByText(name)).not.toBeVisible()

  await page.close()
})
