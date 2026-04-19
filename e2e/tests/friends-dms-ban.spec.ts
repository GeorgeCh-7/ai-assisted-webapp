/**
 * Scorecard item 3 — Friends, DMs, and ban flow.
 *
 * A sends friend request → B accepts → A opens DM thread →
 * A sends DM → B sees it →
 * A bans B → B's DM shows "Conversation frozen" →
 * A unbans B → B reloads → DM is live again (textarea visible).
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

test('friends → DM → ban freezes thread → unban restores it', async ({
  userA,
  userB,
}) => {
  // ── 1. A sends friend request to B ──────────────────────────────────────────
  const reqResp = await userA.context.request.post(`${API}/api/friends/requests`, {
    data: { username: userB.username },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(reqResp.ok(), `friend request: ${await reqResp.text()}`).toBeTruthy()

  // ── 2. B accepts the friend request ─────────────────────────────────────────
  const acceptResp = await userB.context.request.post(
    `${API}/api/friends/requests/${userA.userId}/accept`,
    { headers: { 'X-XSRF-TOKEN': await userB.xsrf() } },
  )
  expect(acceptResp.ok(), `accept friend: ${await acceptResp.text()}`).toBeTruthy()

  // ── 3. A opens a DM thread with B ───────────────────────────────────────────
  const openResp = await userA.context.request.post(`${API}/api/dms/open`, {
    data: { userId: userB.userId },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(openResp.ok(), `open DM: ${await openResp.text()}`).toBeTruthy()
  const thread = (await openResp.json()) as { id: string }

  // ── 4. B opens the DM window and connects ───────────────────────────────────
  const pageB = await userB.context.newPage()
  await pageB.goto(`/dms/${thread.id}`)
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  // ── 5. A sends a DM via the UI ──────────────────────────────────────────────
  const pageA = await userA.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await expect(pageA.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })

  await pageA.locator('textarea').fill('Hello in DM')
  await pageA.keyboard.press('Enter')
  await expect(pageA.getByText('Hello in DM')).toBeVisible({ timeout: 10_000 })
  await expect(pageA.getByText('sending…')).not.toBeVisible({ timeout: 8_000 })

  // B sees the message
  await expect(pageB.getByText('Hello in DM')).toBeVisible({ timeout: 10_000 })

  // ── 6. A bans B ─────────────────────────────────────────────────────────────
  const banResp = await userA.context.request.post(
    `${API}/api/friends/${userB.userId}/ban`,
    { headers: { 'X-XSRF-TOKEN': await userA.xsrf() } },
  )
  expect(banResp.ok(), `ban: ${await banResp.text()}`).toBeTruthy()

  // B's DM thread freezes via UserBanned SignalR event → thread refetches
  await expect(pageB.getByText('Conversation frozen')).toBeVisible({ timeout: 10_000 })
  await expect(
    pageB.getByText('This conversation is frozen. Unblock the user to continue.'),
  ).toBeVisible()

  // ── 7. A unbans B ───────────────────────────────────────────────────────────
  const unbanResp = await userA.context.request.delete(
    `${API}/api/friends/${userB.userId}/ban`,
    { headers: { 'X-XSRF-TOKEN': await userA.xsrf() } },
  )
  expect(unbanResp.ok(), `unban: ${await unbanResp.text()}`).toBeTruthy()

  // No hub event on unban — B must reload to pick up unfrozen state
  await pageB.reload()
  await expect(pageB.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.getByText('Conversation frozen')).not.toBeVisible()
  await expect(pageB.locator('textarea')).toBeVisible()

  await pageA.close()
  await pageB.close()
})
