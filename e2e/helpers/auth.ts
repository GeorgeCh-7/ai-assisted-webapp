import type { Browser, BrowserContext } from '@playwright/test'

export const API = 'http://localhost:5080'

export type UserCreds = { email: string; password: string; username: string }

export type AuthedContext = {
  context: BrowserContext
  xsrf: () => Promise<string>
  userId: string
  username: string
  email: string
  password: string
}

let _seq = 0

export function uniqueUser(prefix: string): UserCreds {
  const n = `${Date.now()}${(_seq++).toString().padStart(3, '0')}`
  return {
    username: `${prefix}${n}`.slice(0, 20),
    email: `${prefix}${n}@t.com`,
    password: 'password123',
  }
}

export async function createAuthedContext(
  browser: Browser,
  creds: UserCreds,
): Promise<AuthedContext> {
  const context = await browser.newContext()

  const reg = await context.request.post(`${API}/api/auth/register`, {
    data: { username: creds.username, email: creds.email, password: creds.password },
  })
  if (!reg.ok()) throw new Error(`register failed: ${await reg.text()}`)

  const login = await context.request.post(`${API}/api/auth/login`, {
    data: { email: creds.email, password: creds.password },
  })
  if (!login.ok()) throw new Error(`login failed: ${await login.text()}`)

  const meResp = await context.request.get(`${API}/api/auth/me`)
  const me = (await meResp.json()) as { id: string; username: string }

  const xsrf = async (): Promise<string> => {
    const cookies = await context.cookies([API])
    return cookies.find(c => c.name === 'XSRF-TOKEN')?.value ?? ''
  }

  return {
    context,
    xsrf,
    userId: me.id,
    username: me.username,
    email: creds.email,
    password: creds.password,
  }
}
