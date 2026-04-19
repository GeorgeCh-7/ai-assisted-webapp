/**
 * Scorecard item 1 — Private rooms + invitations + moderation flow.
 *
 * A creates private room → invites B by username → B sees invitation badge →
 * B accepts → both in room. A promotes B to admin. B deletes A's message as
 * admin. A sees "Message deleted" placeholder. A demotes B. B tries to delete
 * A's next message → Delete option not visible (member can't delete others).
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

test('private room: invitation → accept → promote → admin-delete → demote → member cannot delete', async ({
  userA,
  userB,
}) => {
  // ── 1. A creates a private room ─────────────────────────────────────────────
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `priv-${Date.now()}`, description: '', isPrivate: true },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(roomResp.ok(), `create room failed: ${await roomResp.text()}`).toBeTruthy()
  const room = (await roomResp.json()) as { id: string; name: string }

  // ── 2. A invites B by username ──────────────────────────────────────────────
  const inviteResp = await userA.context.request.post(`${API}/api/rooms/${room.id}/invitations`, {
    data: { username: userB.username },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(inviteResp.ok(), `invite failed: ${await inviteResp.text()}`).toBeTruthy()

  // ── 3. B sees invitation badge and accepts ───────────────────────────────────
  const pageB = await userB.context.newPage()

  // Capture hub errors and warnings from B's page
  const bConsoleLogs: string[] = []
  pageB.on('console', msg => {
    if (msg.type() === 'warn' || msg.type() === 'error') {
      bConsoleLogs.push(`[${msg.type()}] ${msg.text()}`)
    }
  })

  await pageB.goto('/rooms')

  // Bell button in TopNav gets a green count badge when invitations are pending
  const bellWithBadge = pageB.locator('nav button:has(span.bg-emerald-500)')
  await expect(bellWithBadge).toBeVisible({ timeout: 10_000 })
  await bellWithBadge.click()

  await expect(pageB.getByRole('button', { name: 'Accept' })).toBeVisible()
  await pageB.getByRole('button', { name: 'Accept' }).click()

  // Accept navigates B to /rooms/{id}
  await pageB.waitForURL(`**/rooms/${room.id}`, { timeout: 10_000 })

  // ── 4. A navigates to the room ──────────────────────────────────────────────
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await expect(pageA.locator('h1').filter({ hasText: room.name })).toBeVisible()

  // Verify ChatWindow is rendered for both (not redirected to login)
  await expect(pageA.locator('textarea')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.locator('textarea')).toBeVisible({ timeout: 15_000 })

  // Wait for both SignalR connections to confirm room join
  await expect(pageA.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  // Save B's page state for diagnosis if message assertion fails
  await pageB.screenshot({ path: 'test-results/debug-b-connected.png' })

  // ── 5. A sends a message via the chat composer ───────────────────────────────
  await pageA.locator('textarea').fill('Hello from A')
  await pageA.keyboard.press('Enter')

  // Wait for A's optimistic message
  await expect(pageA.getByText('Hello from A')).toBeVisible({ timeout: 10_000 })
  // Wait for message to be confirmed (not stuck in "sending…" optimistic state)
  await expect(pageA.getByText('sending…')).not.toBeVisible({ timeout: 8_000 })
  await pageA.screenshot({ path: 'test-results/debug-a-after-send.png' })

  // Dump B's console before the assertion to diagnose delivery failure
  console.log('B page console logs:', JSON.stringify(bConsoleLogs))
  await expect(pageB.getByText('Hello from A')).toBeVisible({ timeout: 10_000 })

  // ── 6. A promotes B to admin via room settings ───────────────────────────────
  await pageA.getByRole('button', { name: 'Room settings' }).click()
  await pageA.getByRole('tab', { name: /admins/i }).click()

  // Promote the row containing B's username
  const eligibleRow = pageA
    .locator('div')
    .filter({ hasText: userB.username })
    .filter({ has: pageA.getByRole('button', { name: 'promote' }) })
    .first()
  await eligibleRow.getByRole('button', { name: 'promote' }).click()

  // Wait until B appears in the "Current admins" section (mutation complete)
  await expect(pageA.getByText('Current admins')).toBeVisible({ timeout: 8_000 })
  await pageA.keyboard.press('Escape')

  // ── 7. B reloads to pick up new role, then deletes A's message ───────────────
  // RoleChanged event updates room-members cache but not the room's myRole field;
  // reload forces a fresh GET /api/rooms/{id} with myRole: 'admin'.
  await pageB.reload()
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.getByText('Hello from A')).toBeVisible({ timeout: 10_000 })

  const msgRowOnB = pageB.locator('.group').filter({ hasText: 'Hello from A' }).first()
  await msgRowOnB.hover()
  await msgRowOnB.getByRole('button', { name: 'Message actions' }).click()

  await expect(pageB.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  await pageB.getByRole('menuitem', { name: 'Delete' }).click()

  // ── 8. A sees the deleted-message placeholder ────────────────────────────────
  await expect(pageA.getByText('[Message deleted]')).toBeVisible({ timeout: 10_000 })

  // ── 9. A demotes B via room settings ────────────────────────────────────────
  await pageA.getByRole('button', { name: 'Room settings' }).click()
  await pageA.getByRole('tab', { name: /admins/i }).click()

  const adminRow = pageA
    .locator('div')
    .filter({ hasText: userB.username })
    .filter({ has: pageA.getByRole('button', { name: 'demote' }) })
    .first()
  await adminRow.getByRole('button', { name: 'demote' }).click()

  // Wait until "Current admins" disappears (B was the only admin)
  await expect(pageA.getByText('Current admins')).not.toBeVisible({ timeout: 8_000 })
  await pageA.keyboard.press('Escape')

  // ── 10. A sends another message via composer ─────────────────────────────────
  await pageA.locator('textarea').fill('Second from A')
  await pageA.keyboard.press('Enter')
  await expect(pageA.getByText('Second from A')).toBeVisible({ timeout: 10_000 })

  // B sees the message after reloading (picks up member role)
  await pageB.reload()
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.getByText('Second from A')).toBeVisible({ timeout: 10_000 })

  // ── 11. B (member) opens actions on A's message — no Delete option ───────────
  const secondMsgRow = pageB.locator('.group').filter({ hasText: 'Second from A' }).first()
  await secondMsgRow.hover()
  await secondMsgRow.getByRole('button', { name: 'Message actions' }).click()

  // Member can reply but cannot delete others' messages
  await expect(pageB.getByRole('menuitem', { name: 'Reply' })).toBeVisible()
  await expect(pageB.getByRole('menuitem', { name: 'Delete' })).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})
