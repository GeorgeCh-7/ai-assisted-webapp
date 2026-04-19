/**
 * Scorecard item 6 — Real-time presence indicators.
 *
 * Both users are in the same room.
 * B opens the room first (joins the SignalR group).
 * A then opens the room → OnConnectedAsync broadcasts PresenceChanged {online}
 * to all room groups A belongs to → B receives it.
 * A sends a message → the PresenceIndicator next to A's username shows "online".
 * A closes the page → PresenceChanged {offline} fires → B sees A go offline.
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

test('presence: A goes online when connecting, offline when disconnecting', async ({
  userA,
  userB,
}) => {
  // ── Setup: shared public room, B joins ──────────────────────────────────────
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `pres-${Date.now()}`, description: '', isPrivate: false },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(roomResp.ok(), `create room: ${await roomResp.text()}`).toBeTruthy()
  const room = (await roomResp.json()) as { id: string }

  const joinResp = await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(joinResp.ok(), `B join: ${await joinResp.text()}`).toBeTruthy()

  // ── 1. B opens the room first and joins the SignalR group ───────────────────
  // B must be in the group before A connects so it can receive PresenceChanged.
  const pageB = await userB.context.newPage()
  await pageB.goto(`/rooms/${room.id}`)
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  // ── 2. A opens the room → OnConnectedAsync → PresenceChanged {A: online} ────
  const pageA = await userA.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await expect(pageA.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  // ── 3. A sends a message so their username appears in B's MessageList ────────
  await pageA.locator('textarea').fill('presence test')
  await pageA.keyboard.press('Enter')
  await expect(pageA.getByText('presence test')).toBeVisible({ timeout: 10_000 })
  await expect(pageA.getByText('sending…')).not.toBeVisible({ timeout: 8_000 })

  // B sees the message
  await expect(pageB.getByText('presence test')).toBeVisible({ timeout: 10_000 })

  // ── 4. B sees A's presence indicator as "online" ─────────────────────────────
  // PresenceIndicator renders <span title={status} aria-label={status} />;
  // "online" → bg-emerald-500. The indicator sits next to the username in each row.
  const msgRowOnB = pageB.locator('.group').filter({ hasText: 'presence test' }).first()
  await expect(msgRowOnB.locator('span[title="online"]')).toBeVisible({ timeout: 10_000 })

  // ── 5. A closes the page → OnDisconnectedAsync → PresenceChanged {A: offline} ─
  await pageA.close()

  // B sees A's presence indicator flip to "offline"
  await expect(msgRowOnB.locator('span[title="online"]')).not.toBeVisible({ timeout: 10_000 })
  await expect(msgRowOnB.locator('span[title="offline"]')).toBeVisible()

  await pageB.close()
})
