/**
 * Scorecard item 5 — Session management.
 *
 * A logs in from a second context → sessions page shows 2 sessions →
 * A revokes the other session via UI → Other sessions disappears →
 * the revoked context gets 401 on subsequent API calls.
 */

import { test, expect } from '../fixtures/index'
import { API } from '../helpers/auth'

test('sessions: revoke other session invalidates it', async ({ userA, browser }) => {
  // ── 1. Create a second session for the same user ────────────────────────────
  const ctx2 = await browser.newContext()
  const login2 = await ctx2.request.post(`${API}/api/auth/login`, {
    data: { email: userA.email, password: userA.password },
  })
  expect(login2.ok(), `second login: ${await login2.text()}`).toBeTruthy()

  // ── 2. A navigates to the sessions page ─────────────────────────────────────
  const pageA = await userA.context.newPage()
  await pageA.goto('/sessions')

  // Both sessions are listed
  await expect(pageA.getByText('Current session')).toBeVisible({ timeout: 10_000 })
  await expect(pageA.getByText(/Other sessions/)).toBeVisible({ timeout: 5_000 })

  // ── 3. A revokes the other session via the UI Revoke button ─────────────────
  await pageA.getByRole('button', { name: 'Revoke session' }).click()

  // "Other sessions" section disappears immediately (optimistic UI update)
  await expect(pageA.getByText(/Other sessions/)).not.toBeVisible({ timeout: 5_000 })
  // Current session is still shown
  await expect(pageA.getByText('Current session')).toBeVisible()

  // ── 4. The revoked context is now unauthenticated ────────────────────────────
  // No prior authenticated request from ctx2, so no validated_on cache —
  // the next request will hit the DB and get 401.
  const meResp = await ctx2.request.get(`${API}/api/auth/me`)
  expect(meResp.status(), 'revoked session must return 401').toBe(401)

  await ctx2.close()
  await pageA.close()
})
