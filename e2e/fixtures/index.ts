import { test as base } from '@playwright/test'
import { createAuthedContext, uniqueUser } from '../helpers/auth'
import type { AuthedContext } from '../helpers/auth'

export { expect } from '@playwright/test'

type E2EFixtures = {
  userA: AuthedContext
  userB: AuthedContext
  userC: AuthedContext
}

export const test = base.extend<E2EFixtures>({
  userA: async ({ browser }, use) => {
    const ctx = await createAuthedContext(browser, uniqueUser('a'))
    await use(ctx)
    await ctx.context.close()
  },
  userB: async ({ browser }, use) => {
    const ctx = await createAuthedContext(browser, uniqueUser('b'))
    await use(ctx)
    await ctx.context.close()
  },
  userC: async ({ browser }, use) => {
    const ctx = await createAuthedContext(browser, uniqueUser('c'))
    await use(ctx)
    await ctx.context.close()
  },
})
