/**
 * Messaging feature UI tests
 *
 * Covers the reply and edit flows in both rooms and DMs:
 *  1. Reply in room — banner shows "Replying to {user}" with cancel
 *  2. Reply in room — sent reply displays quote block below
 *  3. Edit a room message — indicator shows, content updates on save
 *  4. Edit cancel (Escape) discards changes
 *  5. Reply in DM — same banner + cancel flow
 *  6. Reply in DM — sent reply displays quote block
 *  7. Edit a DM message — same edit flow
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

// ── helpers ───────────────────────────────────────────────────────────────────

async function createRoom(ctx: import('../helpers/auth').AuthedContext, name: string) {
  const r = await ctx.context.request.post(`${API}/api/rooms`, {
    data: { name, description: '' },
    headers: { 'X-XSRF-TOKEN': await ctx.xsrf() },
  })
  if (!r.ok()) throw new Error(`create room: ${await r.text()}`)
  return (await r.json()) as { id: string }
}

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
  if (!acc.ok()) throw new Error(`accept friend: ${await acc.text()}`)
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

async function waitConnected(page: import('@playwright/test').Page) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.keyboard.press('Enter')
  await expect(page.getByText(text)).toBeVisible({ timeout: 8_000 })
}

async function openMessageMenu(page: import('@playwright/test').Page, text: string) {
  const row = page.locator('.group').filter({ hasText: text }).first()
  await row.hover()
  await row.getByRole('button', { name: 'Message actions' }).click()
}

// ── 1. Reply banner appears in room ───────────────────────────────────────────

test('msg: reply banner shows "Replying to {user}" in room', async ({ userA, userB }) => {
  const room = await createRoom(userA, `msg-1-${Date.now()}`)
  await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  const pageA = await userA.context.newPage()
  const pageB = await userB.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  // B sends a message
  await sendMessage(pageB, 'message-to-reply')

  // A sees it and triggers reply
  await expect(pageA.getByText('message-to-reply')).toBeVisible({ timeout: 8_000 })
  await openMessageMenu(pageA, 'message-to-reply')
  await pageA.getByRole('menuitem', { name: /^reply$/i }).click()

  // Banner should show "Replying to {B's username}"
  await expect(pageA.getByText(new RegExp(`replying to ${userB.username}`, 'i'))).toBeVisible({
    timeout: 5_000,
  })

  // Cancel reply clears the banner
  await pageA.getByRole('button', { name: /cancel reply/i }).click()
  await expect(pageA.getByText(new RegExp(`replying to`, 'i'))).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})

// ── 2. Sent reply shows quote block in room ────────────────────────────────────

test('msg: sent reply in room renders quote block with original text', async ({
  userA,
  userB,
}) => {
  const room = await createRoom(userA, `msg-2-${Date.now()}`)
  await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  const pageA = await userA.context.newPage()
  const pageB = await userB.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  // B sends original message
  await sendMessage(pageB, 'original-room-msg')
  await expect(pageA.getByText('original-room-msg')).toBeVisible({ timeout: 8_000 })

  // A replies
  await openMessageMenu(pageA, 'original-room-msg')
  await pageA.getByRole('menuitem', { name: /^reply$/i }).click()
  await expect(pageA.getByText(new RegExp(`replying to ${userB.username}`, 'i'))).toBeVisible({
    timeout: 5_000,
  })
  await pageA.locator('textarea').fill('reply-text')
  await pageA.keyboard.press('Enter')

  // Reply message appears with quote block (border-left styled div)
  await expect(pageA.getByText('reply-text')).toBeVisible({ timeout: 8_000 })
  // The quote block should contain the original text
  await expect(pageA.locator('[class*="border-l"]').filter({ hasText: 'original-room-msg' })).toBeVisible({
    timeout: 5_000,
  })

  await pageA.close()
  await pageB.close()
})

// ── 3. Edit a room message ────────────────────────────────────────────────────

test('msg: edit a room message — indicator shows, content updates on save', async ({ userA }) => {
  const room = await createRoom(userA, `msg-3-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await sendMessage(page, 'before-edit')

  // Open edit
  await openMessageMenu(page, 'before-edit')
  await page.getByRole('menuitem', { name: /^edit$/i }).click()

  // Edit mode indicator visible
  await expect(page.getByText(/editing message/i)).toBeVisible({ timeout: 5_000 })

  // Textarea prefilled; clear and type new content
  await page.locator('textarea').fill('after-edit')
  await page.keyboard.press('Enter')

  // Updated text visible, original gone
  await expect(page.getByText('after-edit')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('before-edit')).not.toBeVisible()

  await page.close()
})

// ── 4. Edit cancel (Escape) discards changes ──────────────────────────────────

test('msg: pressing Escape in edit mode discards the edit', async ({ userA }) => {
  const room = await createRoom(userA, `msg-4-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await sendMessage(page, 'keep-this-text')

  await openMessageMenu(page, 'keep-this-text')
  await page.getByRole('menuitem', { name: /^edit$/i }).click()
  await expect(page.getByText(/editing message/i)).toBeVisible({ timeout: 5_000 })

  // Type something, then Escape
  await page.locator('textarea').fill('discarded-edit')
  await page.keyboard.press('Escape')

  // Edit mode gone; original text still visible
  await expect(page.getByText(/editing message/i)).not.toBeVisible()
  await expect(page.getByText('keep-this-text')).toBeVisible()

  await page.close()
})

// ── 5. Reply banner in DM ─────────────────────────────────────────────────────

test('msg: reply banner shows "Replying to {user}" in DM', async ({ userA, userB }) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  const pageA = await userA.context.newPage()
  const pageB = await userB.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  // B sends a message
  await sendMessage(pageB, 'dm-msg-to-reply')
  await expect(pageA.getByText('dm-msg-to-reply')).toBeVisible({ timeout: 8_000 })

  // A triggers reply
  await openMessageMenu(pageA, 'dm-msg-to-reply')
  await pageA.getByRole('menuitem', { name: /^reply$/i }).click()

  await expect(pageA.getByText(new RegExp(`replying to ${userB.username}`, 'i'))).toBeVisible({
    timeout: 5_000,
  })

  // Cancel clears banner
  await pageA.getByRole('button', { name: /cancel reply/i }).click()
  await expect(pageA.getByText(new RegExp(`replying to`, 'i'))).not.toBeVisible()

  await pageA.close()
  await pageB.close()
})

// ── 6. Sent reply shows quote block in DM ─────────────────────────────────────

test('msg: sent reply in DM renders quote block with original text', async ({ userA, userB }) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  const pageA = await userA.context.newPage()
  const pageB = await userB.context.newPage()
  await pageA.goto(`/dms/${thread.id}`)
  await pageB.goto(`/dms/${thread.id}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  await sendMessage(pageB, 'original-dm-msg')
  await expect(pageA.getByText('original-dm-msg')).toBeVisible({ timeout: 8_000 })

  await openMessageMenu(pageA, 'original-dm-msg')
  await pageA.getByRole('menuitem', { name: /^reply$/i }).click()
  await expect(pageA.getByText(new RegExp(`replying to ${userB.username}`, 'i'))).toBeVisible({
    timeout: 5_000,
  })
  await pageA.locator('textarea').fill('dm-reply-text')
  await pageA.keyboard.press('Enter')

  await expect(pageA.getByText('dm-reply-text')).toBeVisible({ timeout: 8_000 })
  await expect(pageA.locator('[class*="border-l"]').filter({ hasText: 'original-dm-msg' })).toBeVisible({
    timeout: 5_000,
  })

  await pageA.close()
  await pageB.close()
})

// ── 7. Edit a DM message ──────────────────────────────────────────────────────

test('msg: edit a DM message — indicator shows, content updates on save', async ({
  userA,
  userB,
}) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  const page = await userA.context.newPage()
  await page.goto(`/dms/${thread.id}`)
  await waitConnected(page)

  await sendMessage(page, 'dm-before-edit')

  await openMessageMenu(page, 'dm-before-edit')
  await page.getByRole('menuitem', { name: /^edit$/i }).click()

  await expect(page.getByText(/editing message/i)).toBeVisible({ timeout: 5_000 })

  await page.locator('textarea').fill('dm-after-edit')
  await page.keyboard.press('Enter')

  await expect(page.getByText('dm-after-edit')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('dm-before-edit')).not.toBeVisible()

  await page.close()
})
