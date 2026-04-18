import { http, HttpResponse } from 'msw'

type MockUser = {
  id: string
  username: string
  email: string
  password: string
}

type RegisterBody = { username?: string; email?: string; password?: string }
type LoginBody = { email?: string; password?: string }

const db: { users: MockUser[] } = { users: [] }
let sessionUserId: string | null = null

const BASE = import.meta.env.VITE_API_URL

export const handlers = [
  http.post(`${BASE}/api/auth/register`, async ({ request }) => {
    const body = (await request.json()) as RegisterBody
    const { username = '', email = '', password = '' } = body

    if (password.length < 6) {
      return HttpResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      )
    }
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      return HttpResponse.json({ error: 'Username already taken' }, { status: 400 })
    }
    if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return HttpResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    const user: MockUser = { id: crypto.randomUUID(), username, email, password }
    db.users.push(user)

    return HttpResponse.json({ id: user.id, username: user.username, email: user.email })
  }),

  http.post(`${BASE}/api/auth/login`, async ({ request }) => {
    const body = (await request.json()) as LoginBody
    const { email = '', password = '' } = body

    const user = db.users.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password,
    )
    if (!user) {
      return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    sessionUserId = user.id
    return HttpResponse.json({ id: user.id, username: user.username, email: user.email })
  }),

  http.post(`${BASE}/api/auth/logout`, () => {
    sessionUserId = null
    return HttpResponse.json({})
  }),

  http.get(`${BASE}/api/auth/me`, () => {
    if (!sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    const user = db.users.find(u => u.id === sessionUserId)
    if (!user) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    return HttpResponse.json({ id: user.id, username: user.username, email: user.email })
  }),
]
