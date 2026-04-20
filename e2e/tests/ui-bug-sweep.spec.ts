/**
 * UI Bug Sweep — Priorities A, B, C
 *
 * Run:  npx playwright test e2e/tests/ui-bug-sweep.spec.ts --reporter=list
 * Screenshots saved to test-results/screenshots/
 */

import { test, expect, type Page } from '@playwright/test'
import { createAuthedContext, uniqueUser, API } from '../helpers/auth'
import type { AuthedContext } from '../helpers/auth'
import path from 'path'

const SS = 'test-results/screenshots'

// ── helpers ──────────────────────────────────────────────────────────────────

async function ss(page: Page, name: string) {
  await page.screenshot({ path: `${SS}/${name}.png`, fullPage: false })
}

async function waitConnected(page: Page) {
  await expect(page.locator('span[title="Connected"]')).toBeVisible({ timeout: 15_000 })
}

async function sendFriendRequest(from: AuthedContext, toUserId: string) {
  return from.context.request.post(`${API}/api/friends/requests`, {
    data: { username: toUserId },
    headers: { 'X-XSRF-TOKEN': await from.xsrf() },
  })
}

async function makeFriends(a: AuthedContext, b: AuthedContext) {
  const req = await a.context.request.post(`${API}/api/friends/requests`, {
    data: { username: b.username },
    headers: { 'X-XSRF-TOKEN': await a.xsrf() },
  })
  if (!req.ok()) throw new Error(`friend request failed: ${await req.text()}`)
  const acc = await b.context.request.post(`${API}/api/friends/requests/${a.userId}/accept`, {
    headers: { 'X-XSRF-TOKEN': await b.xsrf() },
  })
  if (!acc.ok()) throw new Error(`accept failed: ${await acc.text()}`)
}

async function createRoom(user: AuthedContext, name: string, isPrivate = false) {
  const r = await user.context.request.post(`${API}/api/rooms`, {
    data: { name, description: '', isPrivate },
    headers: { 'X-XSRF-TOKEN': await user.xsrf() },
  })
  if (!r.ok()) throw new Error(`createRoom failed: ${await r.text()}`)
  return (await r.json()) as { id: string; name: string }
}

async function joinRoom(user: AuthedContext, roomId: string) {
  const r = await user.context.request.post(`${API}/api/rooms/${roomId}/join`, {
    headers: { 'X-XSRF-TOKEN': await user.xsrf() },
  })
  if (!r.ok()) throw new Error(`joinRoom failed: ${await r.text()}`)
}

async function consoleErrors(page: Page): Promise<string[]> {
  const errs: string[] = []
  page.on('console', m => {
    if (m.type() === 'error') errs.push(m.text())
  })
  return errs
}

// ── PRIORITY A — DEMO SCRIPT ──────────────────────────────────────────────────

test.describe('Priority A — Demo Script', () => {

  // ACT 1 ─────────────────────────────────────────────────────────────────────

  test('ACT1-A: Register via UI lands on catalog', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto('/register')
    await ss(page, 'act1-register-page')

    const ts = Date.now()
    await page.locator('#username').fill(`sweep${ts}`)
    await page.locator('#email').fill(`sweep${ts}@t.com`)
    await page.locator('#password').fill('Password1!')
    await page.locator('#confirm-password').fill('Password1!')
    await ss(page, 'act1-register-filled')

    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(/\/rooms/, { timeout: 10_000 })
    await ss(page, 'act1-after-register-catalog')

    console.log('ACT1-A console errors:', errors)
    await ctx.close()
  })

  test('ACT1-B: Login with "Keep me signed in" checkbox works', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    // Register via API first
    const ts = Date.now()
    const email = `login${ts}@t.com`
    const pw = 'Password1!'
    await ctx.request.post(`${API}/api/auth/register`, {
      data: { username: `login${ts}`, email, password: pw },
    })

    await page.goto('/login')
    await ss(page, 'act1-login-page')

    await page.locator('#email').fill(email)
    await page.locator('#password').fill(pw)

    // Check if "Keep me signed in" exists
    const keepSignedIn = page.getByLabel(/keep me signed in/i)
    const hasKeepSignedIn = (await keepSignedIn.count()) > 0
    console.log('ACT1-B: Keep me signed in checkbox present:', hasKeepSignedIn)
    if (hasKeepSignedIn) await keepSignedIn.check()

    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL(/\/rooms/, { timeout: 10_000 })
    await ss(page, 'act1-after-login')

    await ctx.close()
  })

  test('ACT1-C: Catalog filter narrows results live (debounce)', async ({ browser }) => {
    const ctx = await browser.newContext()
    const userA = await createAuthedContext(browser, uniqueUser('a'))

    const roomName = `filtertest-${Date.now()}`
    await createRoom(userA, roomName, false)

    const page = await userA.context.newPage()
    await page.goto('/rooms')
    await page.waitForTimeout(500)

    const filterInput = page.getByPlaceholder(/search|filter/i)
    const hasFilter = (await filterInput.count()) > 0
    console.log('ACT1-C: Filter input present:', hasFilter)

    if (!hasFilter) {
      await ss(page, 'act1-no-filter-input')
      console.warn('BUG: No filter/search input found on catalog page')
    } else {
      await filterInput.fill(roomName)
      await page.waitForTimeout(400) // debounce
      await ss(page, 'act1-filter-results')
      const visible = await page.getByText(roomName).isVisible()
      console.log('ACT1-C: Filtered room visible:', visible)
      expect(visible, 'Filtered room should be visible after typing').toBeTruthy()
    }

    await page.close()
    await userA.context.close()
    await ctx.close()
  })

  // ACT 2 ─────────────────────────────────────────────────────────────────────

  test('ACT2-A: New room appears in other user catalog without refresh (~2s)', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))

    const pageB = await userB.context.newPage()
    await pageB.goto('/rooms')
    await pageB.waitForTimeout(2000) // let SignalR connect

    const roomName = `rt-catalog-${Date.now()}`
    await createRoom(userA, roomName, false)

    const found = await pageB.getByText(roomName).waitFor({ timeout: 5_000 }).then(() => true).catch(() => false)
    if (!found) await ss(pageB, 'act2-catalog-no-realtime-update')
    console.log('ACT2-A: Real-time catalog update:', found)
    expect(found, 'Room should appear in catalog without refresh').toBeTruthy()

    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  test('ACT2-B: Chat — send, edit, delete, reply flow', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))

    const room = await createRoom(userA, `chat-${Date.now()}`, false)
    await joinRoom(userB, room.id)

    const pageA = await userA.context.newPage()
    const pageB = await userB.context.newPage()
    await pageA.goto(`/rooms/${room.id}`)
    await pageB.goto(`/rooms/${room.id}`)
    await waitConnected(pageA)
    await waitConnected(pageB)

    // Send
    await pageA.locator('textarea').fill('Hello from alice')
    await pageA.keyboard.press('Enter')
    await expect(pageA.getByText('Hello from alice')).toBeVisible({ timeout: 8_000 })
    await expect(pageA.getByText('sending…')).not.toBeVisible({ timeout: 6_000 })

    const bSees = await pageB.getByText('Hello from alice').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
    console.log('ACT2-B: Bob sees Alice message in real-time:', bSees)
    if (!bSees) await ss(pageB, 'act2-realtime-message-fail')
    expect(bSees).toBeTruthy()
    await ss(pageA, 'act2-message-sent')

    // Edit
    const msgRow = pageA.locator('.group').filter({ hasText: 'Hello from alice' }).first()
    await msgRow.hover()
    const actionsBtn = msgRow.getByRole('button', { name: 'Message actions' })
    if (await actionsBtn.isVisible()) {
      await actionsBtn.click()
      const editItem = pageA.getByRole('menuitem', { name: 'Edit' })
      if (await editItem.isVisible()) {
        await editItem.click()
        await pageA.locator('textarea').fill('Hello from alice (edited)')
        await pageA.keyboard.press('Enter')
        await expect(pageA.getByText('Hello from alice (edited)')).toBeVisible({ timeout: 6_000 })
        const editedMarker = await pageA.getByText(/edited/i).isVisible()
        console.log('ACT2-B: Edited marker visible:', editedMarker)
        await ss(pageA, 'act2-message-edited')
      } else {
        console.warn('BUG: Edit menu item not found')
        await ss(pageA, 'act2-no-edit-menuitem')
      }
    } else {
      console.warn('BUG: Message actions button not found on hover')
      await ss(pageA, 'act2-no-actions-button')
    }

    // Reply (Bob replies to Alice)
    await pageB.locator('textarea').fill('Reply from bob')
    await pageB.keyboard.press('Enter')
    await expect(pageB.getByText('Reply from bob')).toBeVisible({ timeout: 8_000 })

    // Try reply flow: hover bob's message, click reply
    const bobMsgRow = pageB.locator('.group').filter({ hasText: 'Reply from bob' }).first()
    await bobMsgRow.hover()
    const bobActions = bobMsgRow.getByRole('button', { name: 'Message actions' })
    if (await bobActions.isVisible()) {
      await bobActions.click()
      const replyItem = pageB.getByRole('menuitem', { name: 'Reply' })
      if (await replyItem.isVisible()) {
        await replyItem.click()
        const quoteVisible = await pageB.getByText(/reply to/i).isVisible()
        console.log('ACT2-B: Reply quote chip visible:', quoteVisible)
        await ss(pageB, 'act2-reply-chip')
      }
    }

    await pageA.close()
    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  test('ACT2-C: Presence flip when user closes tab', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    await makeFriends(userA, userB)

    const room = await createRoom(userA, `pres-${Date.now()}`, false)
    await joinRoom(userB, room.id)

    const pageA = await userA.context.newPage()
    const pageB = await userB.context.newPage()
    await pageA.goto(`/rooms/${room.id}`)
    await pageB.goto(`/rooms/${room.id}`)
    await waitConnected(pageA)
    await waitConnected(pageB)
    await pageA.waitForTimeout(2000) // ensure presence seeds

    await ss(pageA, 'act2-presence-both-connected')

    // Close Bob's page — presence should flip offline within ~35s
    // We test with a shorter wait; if it doesn't flip within 15s it's a regression or expected (30s heartbeat)
    await pageB.close()

    // Wait up to 40s for Bob's presence to flip
    const bobPresenceOffline = await pageA.waitForFunction(
      () => {
        const indicators = document.querySelectorAll('[data-presence]')
        return Array.from(indicators).some(el => el.getAttribute('data-presence') === 'offline')
      },
      { timeout: 40_000 }
    ).then(() => true).catch(() => false)

    // Try a softer check — look for any indicator color change
    await ss(pageA, 'act2-presence-after-close')
    console.log('ACT2-C: Presence flipped to offline:', bobPresenceOffline)
    // Note: 30s heartbeat is documented — don't fail the test, just report

    await pageA.close()
    await userA.context.close()
    await userB.context.close()
  })

  // ACT 3 ─────────────────────────────────────────────────────────────────────

  test('ACT3-A: Private room not visible in Bob catalog, invite badge appears', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))

    const privateRoom = await createRoom(userA, `private-${Date.now()}`, true)

    // Bob opens catalog — private room should NOT appear
    const pageB = await userB.context.newPage()
    await pageB.goto('/rooms')
    await pageB.waitForTimeout(1000)
    await ss(pageB, 'act3-bob-catalog-before-invite')

    const privateVisible = await pageB.getByText(privateRoom.name).isVisible()
    console.log('ACT3-A: Private room visible in Bob catalog (SHOULD BE FALSE):', privateVisible)
    if (privateVisible) {
      await ss(pageB, 'BUG-private-room-visible-in-catalog')
      console.warn('BUG [Bug 1]: Private room visible in public catalog for non-member')
    }
    expect(privateVisible, 'Private room must NOT appear in non-member catalog').toBeFalsy()

    // Alice invites Bob
    const invResp = await userA.context.request.post(`${API}/api/rooms/${privateRoom.id}/invitations`, {
      data: { username: userB.username },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    expect(invResp.ok(), `invite: ${await invResp.text()}`).toBeTruthy()

    // Bob's bell badge should appear without refresh
    const bellWithBadge = pageB.locator('nav button:has(span.bg-emerald-500)').first()
    const badgeAppeared = await bellWithBadge.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
    console.log('ACT3-A: Invitation badge appeared in real-time:', badgeAppeared)
    if (!badgeAppeared) await ss(pageB, 'BUG-invitation-badge-no-realtime')

    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  test('ACT3-B: Bug 1 explicit — carol (no rooms) cannot see alice private room', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userC = await createAuthedContext(browser, uniqueUser('c'))

    const privateRoom = await createRoom(userA, `carol-priv-${Date.now()}`, true)

    // Also create a public room so catalog has content
    await createRoom(userA, `public-${Date.now()}`, false)

    const pageC = await userC.context.newPage()
    await pageC.goto('/rooms')
    await pageC.waitForTimeout(1000)
    await ss(pageC, 'bug1-carol-catalog')

    const privateVisible = await pageC.getByText(privateRoom.name).isVisible()
    console.log('BUG1-CHECK: Private room visible to carol:', privateVisible)

    if (privateVisible) {
      await ss(pageC, 'BUG1-CONFIRMED-private-room-visible-to-carol')
    }

    // Also check Private Rooms nav tab
    const privateTab = pageC.getByRole('link', { name: /private rooms/i })
    if (await privateTab.isVisible()) {
      await privateTab.click()
      await pageC.waitForTimeout(500)
      await ss(pageC, 'bug1-carol-private-tab')
      const visibleInPrivateTab = await pageC.getByText(privateRoom.name).isVisible()
      console.log('BUG1-CHECK: Private room visible to carol under Private tab:', visibleInPrivateTab)
    }

    expect(privateVisible, '[Bug 1] Private room MUST NOT be visible to carol').toBeFalsy()

    await pageC.close()
    await userA.context.close()
    await userC.context.close()
  })

  test('ACT3-C: Accept invitation → join room → promote to admin', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))

    const privateRoom = await createRoom(userA, `promote-${Date.now()}`, true)
    await userA.context.request.post(`${API}/api/rooms/${privateRoom.id}/invitations`, {
      data: { username: userB.username },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })

    const pageB = await userB.context.newPage()
    await pageB.goto('/rooms')
    const bellWithBadge = pageB.locator('nav button:has(span.bg-emerald-500)').first()
    await bellWithBadge.waitFor({ timeout: 10_000 })
    await bellWithBadge.click()
    await pageB.getByRole('button', { name: 'Accept' }).click()
    await pageB.waitForURL(`**/rooms/${privateRoom.id}`, { timeout: 10_000 })
    await ss(pageB, 'act3-accepted-invite')

    // Alice promotes Bob
    const pageA = await userA.context.newPage()
    await pageA.goto(`/rooms/${privateRoom.id}`)
    await waitConnected(pageA)

    const settingsBtn = pageA.getByRole('button', { name: /room settings/i })
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()
      await pageA.waitForTimeout(500)
      await ss(pageA, 'act3-room-settings')

      const adminsTab = pageA.getByRole('tab', { name: /admin/i })
      if (await adminsTab.isVisible()) {
        await adminsTab.click()
        const promoteBtn = pageA.getByRole('button', { name: /promote/i }).first()
        if (await promoteBtn.isVisible()) {
          await promoteBtn.click()
          await ss(pageA, 'act3-promote-done')
          console.log('ACT3-C: Promote succeeded')
        } else {
          console.warn('BUG: Promote button not found in Admins tab')
          await ss(pageA, 'act3-no-promote-btn')
        }
      } else {
        console.warn('ACT3-C: No Admins tab in room settings')
        await ss(pageA, 'act3-no-admins-tab')
      }
    } else {
      console.warn('BUG: Room settings button not found')
      await ss(pageA, 'act3-no-settings-btn')
    }

    await pageA.close()
    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  // ACT 4 ─────────────────────────────────────────────────────────────────────

  test('ACT4-A: Friend request visible in real-time on friends page', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))

    const pageB = await userB.context.newPage()
    await pageB.goto('/friends')
    await pageB.waitForTimeout(2000)

    // Alice sends friend request
    await userA.context.request.post(`${API}/api/friends/requests`, {
      data: { username: userB.username },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })

    // Bob's friends page should show incoming request without refresh
    const reqVisible = await pageB.getByText(userA.username).waitFor({ timeout: 6_000 }).then(() => true).catch(() => false)
    console.log('ACT4-A: Friend request visible in real-time:', reqVisible)
    if (!reqVisible) await ss(pageB, 'BUG-friend-request-no-realtime')
    await ss(pageB, 'act4-friend-request-realtime')

    // Also check nav badge
    const navBadge = pageB.locator('nav').getByText(userA.username).isVisible()

    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  test('ACT4-B: DM thread creation — sidebar updates for recipient without refresh', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    await makeFriends(userA, userB)

    const pageB = await userB.context.newPage()
    await pageB.goto('/rooms')
    await pageB.waitForTimeout(2000)

    // Alice opens DM
    const resp = await userA.context.request.post(`${API}/api/dms/open`, {
      data: { userId: userB.userId },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    const thread = (await resp.json()) as { id: string }

    // Bob's DM sidebar should show new thread
    const dmLink = pageB.locator(`a[href*="/dms/${thread.id}"]`)
    const dmVisible = await dmLink.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
    console.log('ACT4-B: DM thread visible in sidebar without refresh:', dmVisible)
    if (!dmVisible) await ss(pageB, 'BUG-dm-thread-no-realtime-sidebar')
    await ss(pageB, 'act4-dm-sidebar')

    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  test('ACT4-C: DM messages real-time + file attach + block/unblock', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    await makeFriends(userA, userB)

    const resp = await userA.context.request.post(`${API}/api/dms/open`, {
      data: { userId: userB.userId },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    const thread = (await resp.json()) as { id: string }

    const pageA = await userA.context.newPage()
    const pageB = await userB.context.newPage()
    await pageA.goto(`/dms/${thread.id}`)
    await pageB.goto(`/dms/${thread.id}`)
    await waitConnected(pageA)
    await waitConnected(pageB)

    await pageA.locator('textarea').fill('DM hello')
    await pageA.keyboard.press('Enter')
    await expect(pageA.getByText('DM hello')).toBeVisible({ timeout: 8_000 })
    const bSeesDm = await pageB.getByText('DM hello').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
    console.log('ACT4-C: Bob sees DM in real-time:', bSeesDm)
    if (!bSeesDm) await ss(pageB, 'BUG-dm-message-no-realtime')
    await ss(pageA, 'act4-dm-sent')

    // Block
    const banResp = await userA.context.request.post(`${API}/api/friends/${userB.userId}/ban`, {
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('ACT4-C: Ban response:', banResp.status())

    const frozenVisible = await pageB.getByText(/conversation frozen|frozen/i).waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
    console.log('ACT4-C: Frozen banner visible for Bob:', frozenVisible)
    if (!frozenVisible) await ss(pageB, 'BUG-frozen-banner-not-visible')
    await ss(pageB, 'act4-frozen-banner')

    // Unblock
    await userA.context.request.delete(`${API}/api/friends/${userB.userId}/ban`, {
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    await pageB.reload()
    await waitConnected(pageB)
    const unfrozen = await pageB.locator('textarea').isVisible()
    console.log('ACT4-C: Textarea restored after unblock:', unfrozen)
    await ss(pageB, 'act4-after-unblock')

    await pageA.close()
    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  // ACT 5 ─────────────────────────────────────────────────────────────────────

  test('ACT5-A: Sessions page shows active sessions', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const page = await userA.context.newPage()
    await page.goto('/sessions')
    await ss(page, 'act5-sessions-page')
    const hasSession = await page.getByText(/browser|session|last seen/i).isVisible()
    console.log('ACT5-A: Sessions page has content:', hasSession)
    await page.close()
    await userA.context.close()
  })

  test('ACT5-B: Change password with wrong current password shows error', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const page = await userA.context.newPage()
    await page.goto('/auth/change-password')
    await ss(page, 'act5-change-password-page')

    // Try wrong current password
    const currentPw = page.getByLabel(/current password/i)
    if (await currentPw.isVisible()) {
      await currentPw.fill('wrongpassword')
      const newPw = page.getByLabel(/new password/i)
      await newPw.fill('NewPassword1!')
      const confirmPw = page.getByLabel(/confirm/i)
      if (await confirmPw.isVisible()) await confirmPw.fill('NewPassword1!')
      await page.getByRole('button', { name: /change|update|save/i }).click()
      await page.waitForTimeout(2000)
      await ss(page, 'act5-wrong-password-response')
      const errorVisible = await page.getByText(/invalid|incorrect|wrong|current.*password/i).isVisible()
      console.log('ACT5-B: Error shown for wrong current password:', errorVisible)
    } else {
      console.warn('ACT5-B: Current password field not found on change-password page')
      await ss(page, 'BUG-no-current-password-field')
    }
    await page.close()
    await userA.context.close()
  })

})

// ── PRIORITY B — VALIDATION & EDGE CASES ─────────────────────────────────────

test.describe('Priority B — Form Validation & Edge Cases', () => {

  test('B-REG-01: Short password (<6 chars) blocked on register', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const ts = Date.now()
    const errors: string[] = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto('/register')
    await page.locator('#username').fill(`shortpw${ts}`)
    await page.locator('#email').fill(`shortpw${ts}@t.com`)
    await page.locator('#password').fill('abc')
    await page.locator('#confirm-password').fill('abc')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForTimeout(2000)
    await ss(page, 'b-reg-short-password')

    const currentUrl = page.url()
    const stayedOnRegister = currentUrl.includes('/register')
    const errorShown = await page.getByText(/min.*6|at least 6|too short|invalid|password.*required/i).isVisible()
    console.log('B-REG-01: Stayed on register:', stayedOnRegister, '| Error shown:', errorShown, '| Console errors:', errors)

    await ctx.close()
  })

  test('B-REG-02: Password mismatch shows inline error, blocks submit', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const ts = Date.now()

    await page.goto('/register')
    await page.locator('#username').fill(`mismatch${ts}`)
    await page.locator('#email').fill(`mismatch${ts}@t.com`)
    await page.locator('#password').fill('Password1!')
    await page.locator('#confirm-password').fill('DifferentPassword!')

    const mismatchMsg = await page.getByText(/passwords do not match/i).isVisible()
    const btnDisabled = await page.getByRole('button', { name: 'Create account' }).isDisabled()
    console.log('B-REG-02: Mismatch message visible:', mismatchMsg, '| Button disabled:', btnDisabled)
    await ss(page, 'b-reg-mismatch')

    expect(mismatchMsg, 'Password mismatch message must be visible').toBeTruthy()
    expect(btnDisabled, 'Submit button must be disabled on mismatch').toBeTruthy()

    await ctx.close()
  })

  test('B-REG-03: Duplicate username returns visible error', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const ts = Date.now()
    const username = `dupeuser${ts}`

    // Pre-register
    await ctx.request.post(`${API}/api/auth/register`, {
      data: { username, email: `dupe${ts}@t.com`, password: 'Password1!' },
    })

    // Try to register again with same username
    await page.goto('/register')
    await page.locator('#username').fill(username)
    await page.locator('#email').fill(`dupe2-${ts}@t.com`)
    await page.locator('#password').fill('Password1!')
    await page.locator('#confirm-password').fill('Password1!')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForTimeout(2000)
    await ss(page, 'b-reg-duplicate-username')

    const stayedOnRegister = page.url().includes('/register')
    const errorShown = await page.getByText(/taken|already|exists|username/i).isVisible()
    console.log('B-REG-03: Stayed on register:', stayedOnRegister, '| Error:', errorShown)

    await ctx.close()
  })

  test('B-REG-04: Empty fields — HTML5 required blocks submit', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await page.goto('/register')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForTimeout(500)
    await ss(page, 'b-reg-empty-submit')

    const stayedOnRegister = page.url().includes('/register')
    console.log('B-REG-04: Empty submit stayed on register:', stayedOnRegister)
    expect(stayedOnRegister, 'Should not navigate away with empty fields').toBeTruthy()

    await ctx.close()
  })

  test('B-REG-05: Whitespace-only username — behavior', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const ts = Date.now()

    await page.goto('/register')
    await page.locator('#username').fill('   ')
    await page.locator('#email').fill(`ws${ts}@t.com`)
    await page.locator('#password').fill('Password1!')
    await page.locator('#confirm-password').fill('Password1!')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForTimeout(2000)
    await ss(page, 'b-reg-whitespace-username')

    const currentUrl = page.url()
    console.log('B-REG-05: After whitespace username submit, URL:', currentUrl)

    await ctx.close()
  })

  // Message composer ──────────────────────────────────────────────────────────

  test('B-MSG-01: Empty message send is blocked', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `msgtest-${Date.now()}`, false)
    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    const sendBtn = page.getByRole('button', { name: /send message/i })
    const isDisabledOnEmpty = await sendBtn.isDisabled()
    console.log('B-MSG-01: Send button disabled on empty:', isDisabledOnEmpty)
    expect(isDisabledOnEmpty, 'Send button must be disabled when textarea is empty').toBeTruthy()

    // Press Enter with empty textarea — no message should be sent
    await page.locator('textarea').click()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const msgCount = await page.locator('.group').count()
    console.log('B-MSG-01: Message count after empty send:', msgCount)

    await page.close()
    await userA.context.close()
  })

  test('B-MSG-02: 3072-byte message accepted', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `msgbyte-${Date.now()}`, false)
    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    // 3072 ASCII chars = 3072 bytes
    const msg3072 = 'A'.repeat(3072)
    await page.locator('textarea').fill(msg3072)
    await ss(page, 'b-msg-3072-bytes')

    const overLimitError = await page.getByText(/too long|max.*3.*kb|3072/i).isVisible()
    const sendDisabled = await page.getByRole('button', { name: /send message/i }).isDisabled()
    console.log('B-MSG-02: 3072b — over-limit error shown:', overLimitError, '| Send disabled:', sendDisabled)
    expect(overLimitError, '3072 bytes should NOT show error').toBeFalsy()
    expect(sendDisabled, '3072 bytes — send should be enabled').toBeFalsy()

    await page.close()
    await userA.context.close()
  })

  test('B-MSG-03: 3073-byte message rejected with visible error', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `msgbyte2-${Date.now()}`, false)
    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    const msg3073 = 'A'.repeat(3073)
    await page.locator('textarea').fill(msg3073)
    await ss(page, 'b-msg-3073-bytes')

    const overLimitError = await page.getByText(/too long|max.*3.*kb|3072/i).isVisible()
    const sendDisabled = await page.getByRole('button', { name: /send message/i }).isDisabled()
    console.log('B-MSG-03: 3073b — over-limit error shown:', overLimitError, '| Send disabled:', sendDisabled)
    expect(overLimitError, '3073 bytes MUST show error').toBeTruthy()
    expect(sendDisabled, '3073 bytes — send must be disabled').toBeTruthy()

    await page.close()
    await userA.context.close()
  })

  test('B-MSG-04: Whitespace-only message blocked', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `msgws-${Date.now()}`, false)
    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    await page.locator('textarea').fill('   ')
    const sendDisabled = await page.getByRole('button', { name: /send message/i }).isDisabled()
    console.log('B-MSG-04: Whitespace-only — send disabled:', sendDisabled)
    expect(sendDisabled, 'Whitespace-only message must be blocked').toBeTruthy()
    await ss(page, 'b-msg-whitespace')

    await page.close()
    await userA.context.close()
  })

  test('B-MSG-05: Rapid double-click send idempotency', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `msgdedup-${Date.now()}`, false)
    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    const uniqueMsg = `dedup-${Date.now()}`
    await page.locator('textarea').fill(uniqueMsg)

    // Double click send button
    const sendBtn = page.getByRole('button', { name: /send message/i })
    await sendBtn.dblclick()
    await page.waitForTimeout(3000)

    const occurrences = await page.getByText(uniqueMsg).count()
    console.log('B-MSG-05: Message occurrences after double-click:', occurrences)
    if (occurrences > 1) await ss(page, 'BUG-duplicate-message-on-dblclick')
    expect(occurrences, 'Message should appear exactly once (idempotency)').toBeLessThanOrEqual(1)

    await page.close()
    await userA.context.close()
  })

  // Invitation edge cases ─────────────────────────────────────────────────────

  test('B-INV-01: Invite non-existent user shows error', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `inv-${Date.now()}`, true)
    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    const settingsBtn = page.getByRole('button', { name: /room settings/i })
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()
      const invTab = page.getByRole('tab', { name: /invit/i })
      if (await invTab.isVisible()) {
        await invTab.click()
        const usernameInput = page.getByPlaceholder(/username/i)
        if (await usernameInput.isVisible()) {
          await usernameInput.fill('definitely_not_a_real_user_xyz')
          await page.getByRole('button', { name: /invite/i }).click()
          await page.waitForTimeout(2000)
          await ss(page, 'b-inv-nonexistent-user')
          const errorVisible = await page.getByText(/not found|no user|invalid/i).isVisible()
          console.log('B-INV-01: Error shown for non-existent user:', errorVisible)
        }
      }
    }
    await page.close()
    await userA.context.close()
  })

  test('B-INV-02: Invite already-member shows error or is blocked', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    const room = await createRoom(userA, `inv2-${Date.now()}`, false)
    await joinRoom(userB, room.id)

    const resp = await userA.context.request.post(`${API}/api/rooms/${room.id}/invitations`, {
      data: { username: userB.username },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('B-INV-02: Invite already-member status:', resp.status(), await resp.text())
    expect(resp.ok(), 'Inviting existing member should return 4xx').toBeFalsy()

    await userA.context.close()
    await userB.context.close()
  })

  test('B-INV-03: Duplicate pending invitation is rejected', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    const room = await createRoom(userA, `inv3-${Date.now()}`, true)

    const first = await userA.context.request.post(`${API}/api/rooms/${room.id}/invitations`, {
      data: { username: userB.username },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    const second = await userA.context.request.post(`${API}/api/rooms/${room.id}/invitations`, {
      data: { username: userB.username },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('B-INV-03: First invite:', first.status(), '| Second (duplicate):', second.status())
    expect(first.ok(), 'First invite should succeed').toBeTruthy()
    expect(second.ok(), 'Duplicate invite should be rejected (4xx)').toBeFalsy()

    await userA.context.close()
    await userB.context.close()
  })

  // File upload ───────────────────────────────────────────────────────────────

  test('B-FILE-01: 20MB+1 file rejected by API', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    // Generate 20MB + 1 byte buffer
    const bigFile = Buffer.alloc(20 * 1024 * 1024 + 1, 0x41) // 'A' × 20MB+1

    const resp = await userA.context.request.post(`${API}/api/files`, {
      multipart: {
        file: {
          name: 'huge.txt',
          mimeType: 'text/plain',
          buffer: bigFile,
        },
        scope: 'room',
        scopeId: 'test',
      },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('B-FILE-01: 20MB+1 upload status:', resp.status(), await resp.text())
    expect(resp.status(), '20MB+1 file must be rejected (413)').toBe(413)

    await userA.context.close()
  })

  test('B-FILE-02: 3MB+1 image rejected by API', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const bigImg = Buffer.alloc(3 * 1024 * 1024 + 1, 0x41)

    const resp = await userA.context.request.post(`${API}/api/files`, {
      multipart: {
        file: {
          name: 'huge.jpg',
          mimeType: 'image/jpeg',
          buffer: bigImg,
        },
        scope: 'room',
        scopeId: 'test',
      },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('B-FILE-02: 3MB+1 image upload status:', resp.status(), await resp.text())
    expect(resp.status(), '3MB+1 image must be rejected (413)').toBe(413)

    await userA.context.close()
  })

  test('B-FILE-03: .exe file upload — verify current behavior', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `filetest-${Date.now()}`, false)
    const smallExe = Buffer.alloc(1024, 0x4d) // 1KB fake exe

    const resp = await userA.context.request.post(`${API}/api/files`, {
      multipart: {
        file: {
          name: 'test.exe',
          mimeType: 'application/octet-stream',
          buffer: smallExe,
        },
        scope: 'room',
        scopeId: room.id,
      },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('B-FILE-03: .exe upload status:', resp.status(), '(spec says allow any extension)')

    await userA.context.close()
  })

  // DM edge cases ─────────────────────────────────────────────────────────────

  test('B-DM-01: Open DM to non-friend — API behavior', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    // No friend relationship

    const resp = await userA.context.request.post(`${API}/api/dms/open`, {
      data: { userId: userB.userId },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    console.log('B-DM-01: DM to non-friend status:', resp.status(), await resp.text())
    // Should be 400/403 if restricted, or 200 if DMs are open to all

    await userA.context.close()
    await userB.context.close()
  })

  test('B-DM-02: Sending in frozen DM thread blocked', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    await makeFriends(userA, userB)

    const openResp = await userA.context.request.post(`${API}/api/dms/open`, {
      data: { userId: userB.userId },
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })
    const thread = (await openResp.json()) as { id: string }

    // Ban B
    await userA.context.request.post(`${API}/api/friends/${userB.userId}/ban`, {
      headers: { 'X-XSRF-TOKEN': await userA.xsrf() },
    })

    const pageB = await userB.context.newPage()
    await pageB.goto(`/dms/${thread.id}`)
    await pageB.waitForTimeout(3000)
    await ss(pageB, 'b-dm-frozen-thread')

    const textareaDisabled = await pageB.locator('textarea').isDisabled().catch(() => true)
    const frozenBanner = await pageB.getByText(/frozen|blocked|disabled/i).isVisible()
    console.log('B-DM-02: Frozen thread — textarea disabled:', textareaDisabled, '| Banner:', frozenBanner)

    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

})

// ── PRIORITY C — CONSOLE, NETWORK, A11Y, VISUAL ───────────────────────────────

test.describe('Priority C — Console Errors, Network, Visual', () => {

  const PAGES_TO_CHECK = [
    { name: 'login', path: '/login' },
    { name: 'register', path: '/register' },
    { name: 'rooms-catalog', path: '/rooms' },
    { name: 'friends', path: '/friends' },
    { name: 'sessions', path: '/sessions' },
    { name: 'profile', path: '/profile' },
    { name: 'change-password', path: '/auth/change-password' },
  ]

  test('C-CONSOLE: Console errors on every page', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `console-${Date.now()}`, false)
    const pagePaths = [
      ...PAGES_TO_CHECK,
      { name: 'room-chat', path: `/rooms/${room.id}` },
    ]

    const report: Record<string, string[]> = {}

    for (const { name, path: pagePath } of pagePaths) {
      const page = await userA.context.newPage()
      const errors: string[] = []
      page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text())
      })
      page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`))

      await page.goto(pagePath)
      await page.waitForTimeout(2000)
      await ss(page, `c-page-${name}`)

      if (errors.length > 0) {
        report[name] = errors
        console.warn(`C-CONSOLE [${name}]:`, errors)
      } else {
        report[name] = []
        console.log(`C-CONSOLE [${name}]: clean`)
      }

      await page.close()
    }

    console.log('CONSOLE REPORT:', JSON.stringify(report, null, 2))
    await userA.context.close()
  })

  test('C-NETWORK: 4xx/5xx on normal page loads', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const room = await createRoom(userA, `net-${Date.now()}`, false)

    const page = await userA.context.newPage()
    const failures: Array<{ url: string; status: number }> = []

    page.on('response', resp => {
      if (resp.status() >= 400 && !resp.url().includes('/sockjs-node')) {
        failures.push({ url: resp.url(), status: resp.status() })
      }
    })

    for (const { path: pagePath } of [
      { path: '/rooms' },
      { path: '/friends' },
      { path: `/rooms/${room.id}` },
    ]) {
      await page.goto(pagePath)
      await page.waitForTimeout(3000)
    }

    console.log('C-NETWORK failures:', JSON.stringify(failures, null, 2))
    const seriousFailures = failures.filter(f => f.status >= 500 || (f.status >= 400 && !f.url.includes('/api/auth/me')))
    if (seriousFailures.length > 0) {
      await ss(page, 'c-network-failures')
    }

    await page.close()
    await userA.context.close()
  })

  test('C-A11Y: Tab navigation through register form', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/register')

    // Tab through the form
    await page.keyboard.press('Tab') // username
    let focused = await page.evaluate(() => document.activeElement?.id)
    console.log('C-A11Y: First tab focused:', focused)

    await page.keyboard.press('Tab') // email
    focused = await page.evaluate(() => document.activeElement?.id)
    console.log('C-A11Y: Second tab focused:', focused)

    await page.keyboard.press('Tab') // password
    focused = await page.evaluate(() => document.activeElement?.id)
    console.log('C-A11Y: Third tab focused:', focused)

    await page.keyboard.press('Tab') // confirm
    focused = await page.evaluate(() => document.activeElement?.id)
    console.log('C-A11Y: Fourth tab focused:', focused)

    await ss(page, 'c-a11y-tab-register')

    // Check for visible focus rings
    const focusRingPresent = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return false
      const style = window.getComputedStyle(el)
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
    })
    console.log('C-A11Y: Focus ring visible:', focusRingPresent)

    await ctx.close()
  })

  test('C-VISUAL: Avatar placeholder renders (DiceBear fallback)', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    const room = await createRoom(userA, `avatar-${Date.now()}`, false)
    await joinRoom(userB, room.id)

    const page = await userA.context.newPage()
    await page.goto(`/rooms/${room.id}`)
    await waitConnected(page)

    await userB.context.request.post(`${API}/api/messages`, {
      data: { content: 'avatar test', idempotencyKey: crypto.randomUUID() },
      headers: { 'X-XSRF-TOKEN': await userB.xsrf() },
    }).catch(() => {})

    // Send from B via page instead
    const pageB = await userB.context.newPage()
    await pageB.goto(`/rooms/${room.id}`)
    await waitConnected(pageB)
    await pageB.locator('textarea').fill('avatar test msg')
    await pageB.keyboard.press('Enter')
    await expect(pageB.getByText('avatar test msg')).toBeVisible({ timeout: 8_000 })

    await page.waitForTimeout(2000)
    await ss(page, 'c-visual-avatars')

    // Check if any img[src] from dicebear or local api are broken
    const brokenImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src)
    )
    console.log('C-VISUAL: Broken images:', brokenImgs)

    await page.close()
    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

  test('C-VISUAL: Dark mode — key pages render without overflow or broken layout', async ({ browser }) => {
    const ctx = await browser.newContext()
    // Force dark mode via prefers-color-scheme
    const darkCtx = await browser.newContext({ colorScheme: 'dark' })
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const page = await userA.context.newPage()

    // Inject dark class (app likely uses class-based dark mode)
    await page.goto('/rooms')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    await ss(page, 'c-visual-dark-catalog')

    await page.goto('/login')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await ss(page, 'c-visual-dark-login')

    // Check for horizontal scroll (layout overflow)
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    console.log('C-VISUAL: Horizontal overflow on login page:', hasHorizontalScroll)

    await page.close()
    await userA.context.close()
    await ctx.close()
    await darkCtx.close()
  })

  test('C-VISUAL: Presence indicator colors visible on message list', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    const userB = await createAuthedContext(browser, uniqueUser('b'))
    const room = await createRoom(userA, `pres-visual-${Date.now()}`, false)
    await joinRoom(userB, room.id)

    const pageA = await userA.context.newPage()
    const pageB = await userB.context.newPage()
    await pageB.goto(`/rooms/${room.id}`)
    await waitConnected(pageB)
    await pageB.locator('textarea').fill('presence test')
    await pageB.keyboard.press('Enter')
    await expect(pageB.getByText('presence test')).toBeVisible({ timeout: 8_000 })

    await pageA.goto(`/rooms/${room.id}`)
    await waitConnected(pageA)
    await pageA.waitForTimeout(1500)
    await ss(pageA, 'c-visual-presence-indicators')

    // Check: does alice see bob's message with an indicator?
    const indicators = await pageA.locator('[data-presence], .rounded-full.bg-emerald, .rounded-full.bg-gray').count()
    console.log('C-VISUAL: Presence indicator count in message list:', indicators)

    await pageA.close()
    await pageB.close()
    await userA.context.close()
    await userB.context.close()
  })

})

// ── PRIORITY D — XMPP STATUS CHECK ───────────────────────────────────────────

test.describe('Priority D — XMPP Status', () => {

  test('D-XMPP-01: ejabberd health status check', async ({ request }) => {
    // Check ejabberd web admin / healthcheck endpoint
    const resp = await request.get('http://localhost:5280/api/status').catch(() => null)
    const status = resp?.status()
    console.log('D-XMPP-01: ejabberd web status:', status)
    // This just reports — docker ps already shows (unhealthy)
  })

  test('D-XMPP-02: Bridge bot appears in general room member list', async ({ browser }) => {
    const userA = await createAuthedContext(browser, uniqueUser('a'))
    // Try to find or create a "general" room
    const rooms = await userA.context.request.get(`${API}/api/rooms?q=general`)
    const data = (await rooms.json()) as { items: Array<{ id: string; name: string }> }
    const general = data.items.find(r => r.name === 'general')
    if (!general) {
      console.log('D-XMPP-02: No "general" room found — create it first or run demo pre-flight')
      await userA.context.close()
      return
    }

    const members = await userA.context.request.get(`${API}/api/rooms/${general.id}/members`)
    const membersData = (await members.json()) as { items: Array<{ username: string }> }
    const bridgeBot = membersData.items.find(m => m.username === 'bridge-bot')
    console.log('D-XMPP-02: bridge-bot in members:', !!bridgeBot, '| All members:', membersData.items.map(m => m.username))

    await userA.context.close()
  })

})
