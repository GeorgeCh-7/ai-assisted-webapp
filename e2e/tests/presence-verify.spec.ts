/**
 * BUG-02 verification: presence indicators for existing room members
 * show 'online' immediately when a second user joins the room.
 *
 * Scenario mirrors demo Act 2 step 5:
 *   Alice enters room → sends message → Bob joins → Alice's UI must show
 *   Bob's presence indicator as 'online' within 5s (not 'offline').
 */

import { test, expect } from '@playwright/test'
import { createAuthedContext, uniqueUser, API } from '../helpers/auth'

test('BUG-02: Alice sees Bob online immediately when Bob joins room', async ({ browser }) => {
  const userA = await createAuthedContext(browser, uniqueUser('a'))
  const userB = await createAuthedContext(browser, uniqueUser('b'))

  // Create room; Alice joins automatically as owner
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `presence-verify-${Date.now()}`, description: '', isPrivate: false },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  const room = (await roomResp.json()) as { id: string }

  // Bob joins
  await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  // Alice opens the room first
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await expect(pageA.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  // Alice sends a message so Bob's authorId appears in the message list
  // (we need Bob's message row for the indicator check)
  // Actually, we want to see Bob's indicator after Bob connects.
  // Bob connects next.
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  // Bob sends a message so his authorId appears in Alice's message list
  await pageB.locator('textarea').fill('presence check message')
  await pageB.keyboard.press('Enter')
  await expect(pageB.getByText('presence check message')).toBeVisible({ timeout: 8_000 })

  // Alice should see the message
  await expect(pageA.getByText('presence check message')).toBeVisible({ timeout: 8_000 })

  // The presence indicator for Bob on his message row should be 'online'
  // within 5 seconds of the message appearing (seeded by useRoomMembers).
  // data-presence="online" means the fix is working.
  const bobOnlineIndicator = pageA.locator(`[data-presence="online"]`).first()
  const isOnline = await bobOnlineIndicator.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false)

  await pageA.screenshot({ path: 'test-results/screenshots/bug02-presence-result.png' })

  if (!isOnline) {
    // Check what state indicators ARE showing
    const offlineCount = await pageA.locator('[data-presence="offline"]').count()
    const onlineCount = await pageA.locator('[data-presence="online"]').count()
    console.error(`BUG-02 STILL BROKEN: online=${onlineCount} offline=${offlineCount} — useRoomMembers seed not working`)
  } else {
    console.log('BUG-02 RESOLVED: Bob presence indicator shows online immediately')
  }

  expect(isOnline, 'Bob should appear online in Alice\'s view immediately (not after 30s heartbeat)').toBeTruthy()

  await pageA.close()
  await pageB.close()
  await userA.context.close()
  await userB.context.close()
})
