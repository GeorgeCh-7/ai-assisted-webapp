/**
 * Scorecard item 2 — Message edit permissions.
 *
 * A creates a public room → B joins → A promotes B to admin →
 * A sends a message → B (admin) PATCH → 403 →
 * B UI: Reply + Delete visible, Edit NOT visible →
 * A UI: Edit visible on own message.
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

test('message permissions: only author can edit; admin can delete but not edit', async ({
  userA,
  userB,
}) => {
  // ── 1. A creates a public room ──────────────────────────────────────────────
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `perm-${Date.now()}`, description: '', isPrivate: false },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(roomResp.ok(), `create room: ${await roomResp.text()}`).toBeTruthy()
  const room = (await roomResp.json()) as { id: string; name: string }

  // ── 2. B joins the room ─────────────────────────────────────────────────────
  const joinResp = await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(joinResp.ok(), `join room: ${await joinResp.text()}`).toBeTruthy()

  // ── 3. A promotes B to admin ────────────────────────────────────────────────
  const promoteResp = await userA.context.request.post(
    `${API}/api/rooms/${room.id}/members/${userB.userId}/promote`,
    { headers: { 'X-XSRF-TOKEN': await userA.xsrf() } },
  )
  expect(promoteResp.ok(), `promote B: ${await promoteResp.text()}`).toBeTruthy()

  // ── 4. A opens room and sends a message ─────────────────────────────────────
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await expect(pageA.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  await pageA.locator('textarea').fill('Author only edit me')
  await pageA.keyboard.press('Enter')
  await expect(pageA.getByText('Author only edit me')).toBeVisible({ timeout: 10_000 })
  await expect(pageA.getByText('sending…')).not.toBeVisible({ timeout: 8_000 })

  // ── 5. API: B (admin) tries to edit A's message → 403 ───────────────────────
  const msgsResp = await userB.context.request.get(`${API}/api/rooms/${room.id}/messages`)
  expect(msgsResp.ok()).toBeTruthy()
  const msgs = (await msgsResp.json()) as { items: { id: string; authorUsername: string }[] }
  const aMsg = msgs.items.find(m => m.authorUsername === userA.username)
  expect(aMsg, "A's message must appear in message list").toBeDefined()

  const patchResp = await userB.context.request.patch(`${API}/api/messages/${aMsg!.id}`, {
    data: { content: 'hacked' },
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(patchResp.status(), 'admin editing another user\'s message must be 403').toBe(403)

  // ── 6. UI: B opens room — Edit NOT visible for A's message ──────────────────
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.getByText('Author only edit me')).toBeVisible({ timeout: 10_000 })

  const msgRowOnB = pageB.locator('.group').filter({ hasText: 'Author only edit me' }).first()
  await msgRowOnB.hover()
  await msgRowOnB.getByRole('button', { name: 'Message actions' }).click()

  await expect(pageB.getByRole('menuitem', { name: 'Reply' })).toBeVisible()
  await expect(pageB.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  await expect(pageB.getByRole('menuitem', { name: 'Edit' })).not.toBeVisible()
  await pageB.keyboard.press('Escape')

  // ── 7. UI: A opens own message — Edit IS visible ─────────────────────────────
  const msgRowOnA = pageA.locator('.group').filter({ hasText: 'Author only edit me' }).first()
  await msgRowOnA.hover()
  await msgRowOnA.getByRole('button', { name: 'Message actions' }).click()

  await expect(pageA.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  await expect(pageA.getByRole('menuitem', { name: 'Reply' })).toBeVisible()
  await expect(pageA.getByRole('menuitem', { name: 'Delete' })).toBeVisible()

  await pageA.close()
  await pageB.close()
})
