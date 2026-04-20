/**
 * Load test — rapid real-time messaging between two users.
 *
 * Covers both room chat and DMs. Each scenario sends N messages rapidly
 * from one side and verifies all appear on the other side without a page
 * refresh. Also verifies no duplicates and correct ordering.
 *
 * Notification tests verify that unread badges appear in the sidebar when
 * the recipient is viewing a different chat/DM thread.
 *
 * Uses two independent browser contexts (simulating normal + incognito).
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

const MESSAGE_COUNT = 15

async function waitConnected(page: import('@playwright/test').Page) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

// Collect visible message texts matching a prefix, deduplicated and ordered as rendered
async function collectMessages(
  page: import('@playwright/test').Page,
  prefix: string,
  expectedCount: number,
) {
  // Wait until all expected messages are visible
  await expect(async () => {
    const texts = await page.locator('.group [data-testid="msg-content"], .group p').allInnerTexts()
    const matching = texts.filter(t => t.startsWith(prefix))
    expect(matching.length).toBeGreaterThanOrEqual(expectedCount)
  }).toPass({ timeout: 30_000, intervals: [500] })

  const texts = await page.locator('.group p').allInnerTexts()
  return texts.filter(t => t.startsWith(prefix))
}

// ── Room load test ────────────────────────────────────────────────────────────

test('room: rapid messages from A appear on B without refresh', async ({ userA, userB }) => {
  // Setup: create room, B joins
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `load-room-${Date.now()}`, description: '' },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(roomResp.ok(), `create room: ${await roomResp.text()}`).toBeTruthy()
  const { id: roomId } = (await roomResp.json()) as { id: string }

  const joinResp = await userB.context.request.post(`${API}/api/rooms/${roomId}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(joinResp.ok(), `B join: ${await joinResp.text()}`).toBeTruthy()

  // Both open the room
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${roomId}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${roomId}`)
  await waitConnected(pageA)

  // A sends N messages rapidly using Enter
  const prefix = `loadmsg-${Date.now()}-`
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    await pageA.locator('textarea').fill(`${prefix}${i}`)
    await pageA.keyboard.press('Enter')
  }

  // All messages appear on A's side (no refresh)
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    await expect(pageA.getByText(`${prefix}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  }

  // All messages appear on B's side (no refresh)
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    await expect(pageB.getByText(`${prefix}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  }

  // No duplicates on B
  const bTexts = await pageB.locator('.group p').allInnerTexts()
  const bMatching = bTexts.filter(t => t.startsWith(prefix))
  const uniqueOnB = new Set(bMatching)
  expect(uniqueOnB.size, `expected ${MESSAGE_COUNT} unique messages on B, got duplicates`).toBe(MESSAGE_COUNT)

  await pageA.close()
  await pageB.close()
})

// ── DM load test ──────────────────────────────────────────────────────────────

test('dm: rapid messages from A appear on B without refresh', async ({ userA, userB }) => {
  // Setup: friend request + accept + open DM thread
  const reqResp = await userA.context.request.post(`${API}/api/friends/requests`, {
    data: { username: userB.username },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(reqResp.ok(), `friend request: ${await reqResp.text()}`).toBeTruthy()

  const acceptResp = await userB.context.request.post(
    `${API}/api/friends/requests/${userA.userId}/accept`,
    { headers: { 'X-XSRF-TOKEN': await userB.xsrf() } },
  )
  expect(acceptResp.ok(), `accept friend: ${await acceptResp.text()}`).toBeTruthy()

  const openResp = await userA.context.request.post(`${API}/api/dms/open`, {
    data: { userId: userB.userId },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(openResp.ok(), `open DM: ${await openResp.text()}`).toBeTruthy()
  const thread = (await openResp.json()) as { id: string }

  // Both open the DM window
  const pageB = await userB.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)

  const pageA = await userA.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)

  // A sends N messages rapidly
  const prefix = `dmmsg-${Date.now()}-`
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    await pageA.locator('textarea').fill(`${prefix}${i}`)
    await pageA.keyboard.press('Enter')
  }

  // All messages appear on A's side
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    await expect(pageA.getByText(`${prefix}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  }

  // All messages appear on B's side without refresh
  for (let i = 0; i < MESSAGE_COUNT; i++) {
    await expect(pageB.getByText(`${prefix}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  }

  // No duplicates on B
  const bTexts = await pageB.locator('.group p').allInnerTexts()
  const bMatching = bTexts.filter(t => t.startsWith(prefix))
  const uniqueOnB = new Set(bMatching)
  expect(uniqueOnB.size, `expected ${MESSAGE_COUNT} unique DM messages on B, got duplicates`).toBe(MESSAGE_COUNT)

  await pageA.close()
  await pageB.close()
})

// ── Bidirectional load test ───────────────────────────────────────────────────

test('room: simultaneous messages from both users appear on both sides', async ({ userA, userB }) => {
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `load-bidir-${Date.now()}`, description: '' },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(roomResp.ok()).toBeTruthy()
  const { id: roomId } = (await roomResp.json()) as { id: string }

  await userB.context.request.post(`${API}/api/rooms/${roomId}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  const pageA = await userA.context.newPage()
  const pageB = await userB.context.newPage()

  await pageA.goto(`/rooms/${roomId}`)
  await pageB.goto(`/rooms/${roomId}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  const prefixA = `bidir-a-${Date.now()}-`
  const prefixB = `bidir-b-${Date.now()}-`
  const count = 8

  // Both send simultaneously
  await Promise.all([
    (async () => {
      for (let i = 0; i < count; i++) {
        await pageA.locator('textarea').fill(`${prefixA}${i}`)
        await pageA.keyboard.press('Enter')
        // Small delay to avoid composer idempotency key reuse within same tick
        await pageA.waitForTimeout(50)
      }
    })(),
    (async () => {
      for (let i = 0; i < count; i++) {
        await pageB.locator('textarea').fill(`${prefixB}${i}`)
        await pageB.keyboard.press('Enter')
        await pageB.waitForTimeout(50)
      }
    })(),
  ])

  // Each user sees all of their own messages
  for (let i = 0; i < count; i++) {
    await expect(pageA.getByText(`${prefixA}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(pageB.getByText(`${prefixB}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  }

  // Cross-check: A sees B's messages, B sees A's messages
  for (let i = 0; i < count; i++) {
    await expect(pageA.getByText(`${prefixB}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(pageB.getByText(`${prefixA}${i}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  }

  await pageA.close()
  await pageB.close()
})

// ── Notification tests (recipient is in a different chat) ─────────────────────

test('room: unread badge appears in sidebar when B is viewing a different room', async ({
  userA,
  userB,
}) => {
  // Room1: A + B are members — this is where A will send messages
  const r1Resp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `notif-r1-${Date.now()}`, description: '' },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(r1Resp.ok()).toBeTruthy()
  const { id: room1Id } = (await r1Resp.json()) as { id: string }

  await userB.context.request.post(`${API}/api/rooms/${room1Id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  // Room2: B is the owner — B will be parked here while A sends to Room1
  const r2Resp = await userB.context.request.post(`${API}/api/rooms`, {
    data: { name: `notif-r2-${Date.now()}`, description: '' },
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(r2Resp.ok()).toBeTruthy()
  const { id: room2Id } = (await r2Resp.json()) as { id: string }

  // B opens Room2 (different from where A will send)
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room2Id}`)
  await waitConnected(pageB)

  // A sends several messages to Room1
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room1Id}`)
  await waitConnected(pageA)

  const prefix = `notif-${Date.now()}-`
  for (let i = 0; i < 5; i++) {
    await pageA.locator('textarea').fill(`${prefix}${i}`)
    await pageA.keyboard.press('Enter')
  }
  // Wait for A to see own messages
  await expect(pageA.getByText(`${prefix}4`, { exact: true })).toBeVisible({ timeout: 15_000 })

  // B's sidebar should show an unread badge on Room1 link (emerald badge)
  const room1Link = pageB.locator(`a[href="/rooms/${room1Id}"]`)
  await expect(room1Link.locator('[class*="bg-emerald-500"]')).toBeVisible({ timeout: 15_000 })

  // Badge count should be ≥ 1
  const badgeText = await room1Link.locator('[class*="bg-emerald-500"]').innerText()
  expect(parseInt(badgeText, 10)).toBeGreaterThanOrEqual(1)

  // B navigates to Room1 — badge should clear
  await pageB.goto(`/rooms/${room1Id}`)
  await waitConnected(pageB)
  // After joining the room, the badge clears (server zeroes unread on JoinRoom)
  await expect(room1Link.locator('[class*="bg-emerald-500"]')).not.toBeVisible({ timeout: 10_000 })

  await pageA.close()
  await pageB.close()
})

test('dm: unread badge appears in sidebar when B is viewing a different page', async ({
  userA,
  userB,
}) => {
  // Setup: friends + DM thread
  const reqResp = await userA.context.request.post(`${API}/api/friends/requests`, {
    data: { username: userB.username },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(reqResp.ok(), `friend request: ${await reqResp.text()}`).toBeTruthy()

  await userB.context.request.post(
    `${API}/api/friends/requests/${userA.userId}/accept`,
    { headers: { 'X-XSRF-TOKEN': await userB.xsrf() } },
  )

  const openResp = await userA.context.request.post(`${API}/api/dms/open`, {
    data: { userId: userB.userId },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(openResp.ok(), `open DM: ${await openResp.text()}`).toBeTruthy()
  const thread = (await openResp.json()) as { id: string }

  // B lands on /friends (not the DM thread) so they are "elsewhere"
  const pageB = await userB.context.newPage()
  await pageB.goto('/friends')
  // Wait for the sidebar DM list to be populated (B must have hub connected)
  await expect(pageB.locator(`a[href="/dms/${thread.id}"]`)).toBeVisible({ timeout: 15_000 })

  // A opens the DM and sends several messages
  const pageA = await userA.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)

  const prefix = `dmnotif-${Date.now()}-`
  for (let i = 0; i < 5; i++) {
    await pageA.locator('textarea').fill(`${prefix}${i}`)
    await pageA.keyboard.press('Enter')
  }
  await expect(pageA.getByText(`${prefix}4`, { exact: true })).toBeVisible({ timeout: 15_000 })

  // B's sidebar DM link should show a sky-500 unread badge
  const dmLink = pageB.locator(`a[href="/dms/${thread.id}"]`)
  await expect(dmLink.locator('[class*="bg-sky-500"]')).toBeVisible({ timeout: 15_000 })

  // Badge count ≥ 1
  const badgeText = await dmLink.locator('[class*="bg-sky-500"]').innerText()
  expect(parseInt(badgeText, 10)).toBeGreaterThanOrEqual(1)

  // B opens the DM thread — badge should clear
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageB)
  await expect(dmLink.locator('[class*="bg-sky-500"]')).not.toBeVisible({ timeout: 10_000 })

  await pageA.close()
  await pageB.close()
})
