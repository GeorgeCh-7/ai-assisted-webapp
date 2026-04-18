import { http, HttpResponse } from 'msw'
import { db, getRoomDto, type MockUser, type MockMessage } from './db'

type RegisterBody = { username?: string; email?: string; password?: string }
type LoginBody = { email?: string; password?: string }
type CreateRoomBody = { name?: string; description?: string }

const BASE = import.meta.env.VITE_API_URL

function encodeCursor(name: string, id: string): string {
  return btoa(JSON.stringify({ name, id }))
}

function decodeCursor(cursor: string): { name: string; id: string } | null {
  try {
    return JSON.parse(atob(cursor)) as { name: string; id: string }
  } catch {
    return null
  }
}

export const handlers = [
  // ── Auth ────────────────────────────────────────────────────────────────────

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

    db.sessionUserId = user.id
    return HttpResponse.json({ id: user.id, username: user.username, email: user.email })
  }),

  http.post(`${BASE}/api/auth/logout`, () => {
    db.sessionUserId = null
    return HttpResponse.json({})
  }),

  http.get(`${BASE}/api/auth/me`, () => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    const user = db.users.find(u => u.id === db.sessionUserId)
    if (!user) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    return HttpResponse.json({ id: user.id, username: user.username, email: user.email })
  }),

  // ── Messages (before rooms so /:roomId/messages isn't swallowed by /:roomId) ─

  http.get(`${BASE}/api/rooms/:roomId/messages`, ({ params, request }) => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    const { roomId } = params as { roomId: string }
    if (!db.rooms.has(roomId)) {
      return HttpResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const members = db.memberships.get(roomId)
    if (!members?.has(db.sessionUserId)) {
      return HttpResponse.json({ error: 'Not a member' }, { status: 403 })
    }

    const url = new URL(request.url)
    const beforeParam = url.searchParams.get('before')
    const sinceParam = url.searchParams.get('since')
    const limitParam = parseInt(url.searchParams.get('limit') ?? '')
    const limit = Math.min(Number.isNaN(limitParam) ? 50 : limitParam, 50)

    const all = db.messages.get(roomId) ?? []

    let items: MockMessage[]
    let nextCursor: string | null

    if (sinceParam !== null) {
      const since = parseInt(sinceParam)
      const filtered = all.filter(m => m.watermark > since) // already ASC
      items = filtered.slice(0, limit)
      nextCursor =
        filtered.length > limit ? String(items[items.length - 1].watermark) : null
    } else {
      const before = beforeParam !== null ? parseInt(beforeParam) : null
      // .filter / spread creates a new array; .reverse() is safe in-place
      const desc = (before !== null ? all.filter(m => m.watermark < before) : [...all]).reverse()
      items = desc.slice(0, limit)
      nextCursor = desc.length > limit ? String(items[items.length - 1].watermark) : null
    }

    return HttpResponse.json({ items, nextCursor })
  }),

  // ── Room sub-actions ────────────────────────────────────────────────────────

  http.post(`${BASE}/api/rooms/:roomId/join`, ({ params }) => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    const { roomId } = params as { roomId: string }
    if (!db.rooms.has(roomId)) {
      return HttpResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    if (!db.memberships.has(roomId)) db.memberships.set(roomId, new Map())
    const members = db.memberships.get(roomId)!

    if (members.has(db.sessionUserId)) {
      return HttpResponse.json({ error: 'Already a member' }, { status: 409 })
    }

    members.set(db.sessionUserId, 'member')
    return HttpResponse.json(getRoomDto(roomId, db.sessionUserId))
  }),

  http.post(`${BASE}/api/rooms/:roomId/leave`, ({ params }) => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    const { roomId } = params as { roomId: string }
    if (!db.rooms.has(roomId)) {
      return HttpResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const members = db.memberships.get(roomId)
    const role = members?.get(db.sessionUserId)

    if (!role) return HttpResponse.json({ error: 'Not a member' }, { status: 400 })
    if (role === 'owner') {
      return HttpResponse.json(
        { error: 'Owner cannot leave their own room' },
        { status: 403 },
      )
    }

    members!.delete(db.sessionUserId)
    return HttpResponse.json({})
  }),

  // ── Rooms CRUD ──────────────────────────────────────────────────────────────

  http.get(`${BASE}/api/rooms/:roomId`, ({ params }) => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    const { roomId } = params as { roomId: string }
    const dto = getRoomDto(roomId, db.sessionUserId)
    if (!dto) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })

    return HttpResponse.json(dto)
  }),

  http.get(`${BASE}/api/rooms`, ({ request }) => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    const cursor = url.searchParams.get('cursor')
    const limitParam = parseInt(url.searchParams.get('limit') ?? '')
    const limit = Math.min(Number.isNaN(limitParam) ? 20 : limitParam, 50)

    const sorted = [...db.rooms.values()].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name)
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
    })

    const searched = q
      ? sorted.filter(r => r.name.toLowerCase().includes(q.toLowerCase()))
      : sorted

    const decoded = cursor ? decodeCursor(cursor) : null
    const afterCursor = decoded
      ? searched.filter(r => {
          const cmp = r.name.localeCompare(decoded.name)
          return cmp > 0 || (cmp === 0 && r.id > decoded.id)
        })
      : searched

    const items = afterCursor.slice(0, limit)
    const hasMore = afterCursor.length > limit
    const nextCursor = hasMore
      ? encodeCursor(items[items.length - 1].name, items[items.length - 1].id)
      : null

    return HttpResponse.json({
      items: items.map(r => getRoomDto(r.id, db.sessionUserId)),
      nextCursor,
    })
  }),

  http.post(`${BASE}/api/rooms`, async ({ request }) => {
    if (!db.sessionUserId) {
      return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    const body = (await request.json()) as CreateRoomBody
    const name = (body.name ?? '').trim()
    const description = (body.description ?? '').trim()

    if (!name) return HttpResponse.json({ error: 'Name is required' }, { status: 400 })

    if ([...db.rooms.values()].some(r => r.name.toLowerCase() === name.toLowerCase())) {
      return HttpResponse.json({ error: 'Room name already taken' }, { status: 409 })
    }

    const id = crypto.randomUUID()
    db.rooms.set(id, { id, name, description, createdById: db.sessionUserId, isPrivate: false })
    db.memberships.set(id, new Map([[db.sessionUserId, 'owner']]))
    db.watermarks.set(id, 0)
    db.messages.set(id, [])

    return HttpResponse.json(getRoomDto(id, db.sessionUserId), { status: 201 })
  }),
]
