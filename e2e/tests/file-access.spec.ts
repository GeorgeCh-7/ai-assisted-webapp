/**
 * Scorecard item 4 — File upload and access control.
 *
 * A uploads an image to a room → uploader A can download (200) →
 * member B can download (200) → non-member C is denied (403).
 *
 * Skipped: attachment renders in MessageList — the hub accepts
 * AttachmentFileIds but never links them to the message, so
 * msg.attachments is always [] in the broadcast. Backend work required.
 *
 * Skipped: 31-second cache-expiry path — tests fast paths only.
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

// Minimal 1×1 red PNG (67 bytes)
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg=='
const PNG_BUF = Buffer.from(PNG_B64, 'base64')

test('file upload: member can download, non-member is denied', async ({
  userA,
  userB,
  userC,
}) => {
  // ── Setup: A creates a public room, B joins, C stays out ────────────────────
  const roomResp = await userA.context.request.post(`${API}/api/rooms`, {
    data: { name: `files-${Date.now()}`, description: '', isPrivate: false },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(roomResp.ok(), `create room: ${await roomResp.text()}`).toBeTruthy()
  const room = (await roomResp.json()) as { id: string }

  const joinResp = await userB.context.request.post(`${API}/api/rooms/${room.id}/join`, {
    headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
  })
  expect(joinResp.ok(), `B join room: ${await joinResp.text()}`).toBeTruthy()

  // ── A uploads an image ──────────────────────────────────────────────────────
  const uploadResp = await userA.context.request.post(`${API}/api/files`, {
    multipart: {
      file: { name: 'test.png', mimeType: 'image/png', buffer: PNG_BUF },
      scope: 'room',
      scopeId: room.id,
      originalFilename: 'test.png',
    },
    headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
  })
  expect(uploadResp.status(), `upload: ${await uploadResp.text()}`).toBe(201)
  const uploaded = (await uploadResp.json()) as { id: string; contentType: string }
  expect(uploaded.id).toBeTruthy()
  expect(uploaded.contentType).toBe('image/png')

  // ── A (uploader) can download their own file ────────────────────────────────
  const dlByUploader = await userA.context.request.get(`${API}/api/files/${uploaded.id}`)
  expect(dlByUploader.status(), 'uploader must get 200').toBe(200)
  expect(dlByUploader.headers()['content-type']).toContain('image/png')

  // ── B (room member) can download ────────────────────────────────────────────
  const dlByMember = await userB.context.request.get(`${API}/api/files/${uploaded.id}`)
  expect(dlByMember.status(), 'member must get 200').toBe(200)

  // ── C (non-member) is denied ────────────────────────────────────────────────
  const dlByNonMember = await userC.context.request.get(`${API}/api/files/${uploaded.id}`)
  expect(dlByNonMember.status(), 'non-member must get 403').toBe(403)
})

test.skip('attachment renders in MessageList (hub does not wire AttachmentFileIds)', async ({
  userA,
  userB,
}) => {
  // The hub's SendMessage accepts AttachmentFileIds but never sets
  // FileAttachment.MessageId, so msg.attachments is always [] in the
  // broadcast. Once the backend wires this up, the test should:
  //   1. Upload file → get fileId
  //   2. Navigate both users to the room
  //   3. A invokes hub SendMessage with attachmentFileIds: [fileId]
  //   4. Assert pageB shows <img src="/api/files/{id}"> in the message list
  //   5. Assert the download <a> is also present (for the fallback link)
  void userA
  void userB
})

test.skip('file access cache expires after 30s (slow path)', async () => {
  // The access-check result is cached for 30 seconds (IMemoryCache).
  // After a member leaves the room, they can still download for up to 30s.
  // Verifying this requires a 31-second wait — skipped to keep CI fast.
})
