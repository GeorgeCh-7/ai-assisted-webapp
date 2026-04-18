/**
 * Scorecard item 6 — server-side dedup under concurrent same-key sends.
 *
 * Drives the hub directly from Node.js (not the browser) using
 * @microsoft/signalr's Node.js transport. Opens one SignalR connection,
 * invokes SendMessage 10× in parallel with the same idempotencyKey,
 * then verifies via REST that exactly one message row was persisted.
 *
 * Requires: docker compose up (API at http://localhost:5080)
 */

import { randomUUID } from 'crypto'
import { test, expect, type Page } from '@playwright/test'
import * as signalR from '@microsoft/signalr'

const API = 'http://localhost:5080'

// Reads the XSRF-TOKEN cookie set by GET /api/auth/me.
// page.context().cookies() returns all cookies in the browser context,
// which is shared with page.request — so REST calls and cookie reads stay in sync.
async function readXsrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies([API])
  return cookies.find(c => c.name === 'XSRF-TOKEN')?.value ?? ''
}

test('10 parallel SendMessage with the same idempotencyKey produce exactly one row', async ({ page }) => {
  const ts = Date.now()
  const email = `dedup-${ts}@test.com`
  const username = `dedup${ts}`

  // ── 1. Register + login (no CSRF required for these two endpoints) ──────────
  const regResp = await page.request.post(`${API}/api/auth/register`, {
    data: { username, email, password: 'password123' },
  })
  expect(regResp.ok(), `register failed: ${await regResp.text()}`).toBeTruthy()

  const loginResp = await page.request.post(`${API}/api/auth/login`, {
    data: { email, password: 'password123' },
  })
  expect(loginResp.ok(), `login failed: ${await loginResp.text()}`).toBeTruthy()

  // ── 2. Seed CSRF cookie ─────────────────────────────────────────────────────
  await page.request.get(`${API}/api/auth/me`)

  // ── 3. Create room — creator is automatically the owner/member ──────────────
  const roomResp = await page.request.post(`${API}/api/rooms`, {
    data: { name: `dedup-room-${ts}`, description: '' },
    headers: { 'X-XSRF-TOKEN': await readXsrf(page) },
  })
  expect(roomResp.ok(), `create room failed: ${await roomResp.text()}`).toBeTruthy()
  const { id: roomId } = (await roomResp.json()) as { id: string }

  // ── 4. Extract session cookie for the Node.js SignalR client ────────────────
  // page.context().cookies() shares state with page.request — the .chat.session
  // cookie was written by the login response above.
  const cookies = await page.context().cookies([API])
  const session = cookies.find(c => c.name === '.chat.session')
  expect(session, '.chat.session cookie must be present after login').toBeDefined()
  const cookieHeader = `${session!.name}=${session!.value}`

  // ── 5. Open a SignalR connection in Node.js (no browser required) ───────────
  // The hub only needs the session cookie — no CSRF for SignalR endpoints.
  const conn = new signalR.HubConnectionBuilder()
    .withUrl(`${API}/hubs/chat`, { headers: { Cookie: cookieHeader } })
    .configureLogging(signalR.LogLevel.Error)
    .build()

  const hubErrors: unknown[] = []
  conn.on('Error', err => hubErrors.push(err))

  await conn.start()
  await conn.invoke('JoinRoom', { roomId })

  // ── 6. Fire 10 identical sends in parallel ───────────────────────────────────
  const idempotencyKey = randomUUID()

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      conn.invoke<{ id: string; watermark: number } | null>('SendMessage', {
        roomId,
        content: 'concurrent dedup test',
        idempotencyKey,
      }),
    ),
  )

  await conn.stop()

  // ── 7. Assert hub-level invariants ──────────────────────────────────────────
  expect(hubErrors, 'hub must not emit any Error events for duplicate keys').toHaveLength(0)

  // Every invoke must resolve (no nulls — null means the hub sent an Error)
  const resolved = results.filter(r => r !== null)
  expect(resolved, 'all 10 invocations must resolve').toHaveLength(10)

  // All 10 return values must carry the same message id
  const returnedIds = resolved.map(r => r!.id)
  expect(new Set(returnedIds).size, 'all results must share a single id').toBe(1)
  expect(returnedIds[0], 'returned id must equal the idempotency key').toBe(idempotencyKey)

  // ── 8. REST verification — exactly one row in the DB ────────────────────────
  const msgsResp = await page.request.get(`${API}/api/rooms/${roomId}/messages`, {
    params: { limit: '50' },
  })
  expect(msgsResp.ok()).toBeTruthy()
  const { items } = (await msgsResp.json()) as { items: { id: string }[] }

  const matching = items.filter(m => m.id === idempotencyKey)
  expect(matching, 'exactly one persisted row with this idempotency key').toHaveLength(1)
})
