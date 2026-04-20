/**
 * Attachment UI tests
 *
 * Tests the file-attachment flow in MessageComposer for both rooms and DMs:
 *  1. Paperclip button visible in room composer (hidden in edit mode)
 *  2. Selecting a file shows a pending chip with the filename
 *  3. Removing the chip via X clears the pending file
 *  4. Uploading a file shows uploading indicator, then chip appears
 *  5. Can send a message-only with a pending file (file-only send)
 *  6. Pending chips survive if send fails (disabled state guard)
 *  7. Multiple files can be attached before sending
 *  8. Paperclip hidden in DM composer when in edit mode
 *  9. Same flow works inside a DM thread
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

// ── helpers ───────────────────────────────────────────────────────────────────

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

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

async function waitConnected(page: import('@playwright/test').Page) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

// Small helper to attach a file via the hidden input (Playwright's setInputFiles)
async function attachFile(
  page: import('@playwright/test').Page,
  filename: string,
  mimeType: string,
  buf: Buffer,
) {
  const input = page.locator('input[type="file"]')
  await input.setInputFiles({ name: filename, mimeType, buffer: buf })
}

// ── 1. Paperclip visible in room composer, hidden in edit mode ─────────────────

test('attach: paperclip button visible in room composer', async ({ userA }) => {
  const room = await createRoom(userA, `attach-1-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await expect(page.locator('button[aria-label="Attach file"]')).toBeVisible()

  await page.close()
})

// ── 2. Selecting a file shows a pending chip ───────────────────────────────────

test('attach: selecting a file shows pending chip with filename', async ({ userA }) => {
  const room = await createRoom(userA, `attach-2-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await attachFile(page, 'hello.png', 'image/png', PNG_1PX)

  // Pending chip appears with filename
  await expect(page.getByText('hello.png')).toBeVisible({ timeout: 8_000 })
  // Remove (X) button also visible
  await expect(page.locator('button[aria-label="Remove attachment"]')).toBeVisible()

  await page.close()
})

// ── 3. Removing the chip clears the pending file ───────────────────────────────

test('attach: X button removes the pending file chip', async ({ userA }) => {
  const room = await createRoom(userA, `attach-3-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await attachFile(page, 'remove-me.png', 'image/png', PNG_1PX)
  await expect(page.getByText('remove-me.png')).toBeVisible({ timeout: 8_000 })

  await page.locator('button[aria-label="Remove attachment"]').click()
  await expect(page.getByText('remove-me.png')).not.toBeVisible()
  // No pending chips left
  await expect(page.locator('button[aria-label="Remove attachment"]')).not.toBeVisible()

  await page.close()
})

// ── 4. Sending a file-only message (no text) ───────────────────────────────────

test('attach: file alone (no text) enables send and clears chip after send', async ({
  userA,
  userB,
}) => {
  const room = await createRoom(userA, `attach-4-${Date.now()}`)
  await userA.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  const pageA = await userA.context.newPage()
  const pageB = await userB.context.newPage()
  await pageA.goto(`/rooms/${room.id}`)
  await pageB.goto(`/rooms/${room.id}`)
  await waitConnected(pageA)
  await waitConnected(pageB)

  // Attach a file with no text — send button should become active
  await attachFile(pageA, 'file-only.png', 'image/png', PNG_1PX)
  await expect(pageA.getByText('file-only.png')).toBeVisible({ timeout: 8_000 })

  const sendBtn = pageA.locator('button[aria-label="Send message"]')
  await expect(sendBtn).not.toBeDisabled({ timeout: 8_000 })

  // Send — chip should disappear after send
  await sendBtn.click()
  await expect(pageA.getByText('file-only.png')).not.toBeVisible({ timeout: 5_000 })

  await pageA.close()
  await pageB.close()
})

// ── 5. Multiple files can be attached ─────────────────────────────────────────

test('attach: multiple files can be queued before sending', async ({ userA }) => {
  const room = await createRoom(userA, `attach-5-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  await attachFile(page, 'first.png', 'image/png', PNG_1PX)
  await expect(page.getByText('first.png')).toBeVisible({ timeout: 8_000 })

  await attachFile(page, 'second.txt', 'text/plain', Buffer.from('hello'))
  await expect(page.getByText('second.txt')).toBeVisible({ timeout: 5_000 })

  // Both chips visible
  await expect(page.locator('button[aria-label="Remove attachment"]')).toHaveCount(2)

  await page.close()
})

// ── 6. Paperclip hidden in edit mode ──────────────────────────────────────────

test('attach: paperclip is hidden when editing a message', async ({ userA }) => {
  const room = await createRoom(userA, `attach-6-${Date.now()}`)
  const page = await userA.context.newPage()
  await page.goto(`/rooms/${room.id}`)
  await waitConnected(page)

  // Send a message first
  await page.locator('textarea').fill('edit-me')
  await page.keyboard.press('Enter')
  await expect(page.getByText('edit-me')).toBeVisible({ timeout: 8_000 })

  // Click the message actions dropdown, then Edit
  const row = page.locator('.group').filter({ hasText: 'edit-me' }).first()
  await row.hover()
  const menuBtn = row.locator('button[aria-label="Message actions"]')
  await expect(menuBtn).toBeVisible({ timeout: 5_000 })
  await menuBtn.click()
  await page.getByRole('menuitem', { name: /^edit$/i }).click()

  // Now in edit mode — paperclip should not be visible
  await expect(page.locator('button[aria-label="Attach file"]')).not.toBeVisible()
  // Edit mode indicator shows
  await expect(page.getByText(/editing message/i)).toBeVisible()

  await page.close()
})

// ── 7. Upload API returns 201 with id and contentType ─────────────────────────

test('attach: API upload succeeds and returns file metadata', async ({ userA }) => {
  const room = await createRoom(userA, `attach-7-${Date.now()}`)

  const resp = await userA.context.request.post(`${API}/api/files`, {
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    multipart: {
      file: { name: 'api-test.png', mimeType: 'image/png', buffer: PNG_1PX },
      scope: 'room',
      scopeId: room.id,
      originalFilename: 'api-test.png',
    },
  })

  expect(resp.status()).toBe(201)
  const body = await resp.json() as { id: string; contentType: string; sizeBytes: number; originalFilename: string }
  expect(body.id).toBeTruthy()
  expect(body.contentType).toBe('image/png')
  expect(body.originalFilename).toBe('api-test.png')
  expect(body.sizeBytes).toBeGreaterThan(0)
})

// ── 8. File size validation — 20MB+1 byte is rejected ─────────────────────────

test('attach: file larger than 20MB is rejected (413)', async ({ userA }) => {
  const room = await createRoom(userA, `attach-8-${Date.now()}`)
  const bigBuf = Buffer.alloc(20 * 1024 * 1024 + 1, 0x41)

  const resp = await userA.context.request.post(`${API}/api/files`, {
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    multipart: {
      file: { name: 'huge.bin', mimeType: 'application/octet-stream', buffer: bigBuf },
      scope: 'room',
      scopeId: room.id,
      originalFilename: 'huge.bin',
    },
  })

  expect(resp.status()).toBe(413)
})

// ── 9. Same attach flow works inside a DM thread ──────────────────────────────

test('attach: file attach chip flow works in DM composer', async ({ userA, userB }) => {
  await makeFriends(userA, userB)
  const thread = await openDm(userA, userB)

  const page = await userA.context.newPage()
  await page.goto(`/dms/${thread.id}`)
  await waitConnected(page)

  // Paperclip present in DM
  await expect(page.locator('button[aria-label="Attach file"]')).toBeVisible()

  await attachFile(page, 'dm-attach.png', 'image/png', PNG_1PX)
  await expect(page.getByText('dm-attach.png')).toBeVisible({ timeout: 8_000 })

  // Remove it
  await page.locator('button[aria-label="Remove attachment"]').click()
  await expect(page.getByText('dm-attach.png')).not.toBeVisible()

  await page.close()
})

// ── 10. Uploaded file is accessible by room member ────────────────────────────

test('attach: uploaded file accessible by room member, denied to non-member', async ({
  userA,
  userB,
  userC,
}) => {
  const room = await createRoom(userA, `attach-10-${Date.now()}`)
  // B joins, C does not
  await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })

  const upload = await userA.context.request.post(`${API}/api/files`, {
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    multipart: {
      file: { name: 'access.png', mimeType: 'image/png', buffer: PNG_1PX },
      scope: 'room',
      scopeId: room.id,
      originalFilename: 'access.png',
    },
  })
  expect(upload.status()).toBe(201)
  const { id } = await upload.json() as { id: string }

  // Uploader A can access
  expect((await userA.context.request.get(`${API}/api/files/${id}`)).status()).toBe(200)
  // Member B can access
  expect((await userB.context.request.get(`${API}/api/files/${id}`)).status()).toBe(200)
  // Non-member C is denied
  expect((await userC.context.request.get(`${API}/api/files/${id}`)).status()).toBe(403)
})
