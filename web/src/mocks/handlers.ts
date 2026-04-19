import { http, HttpResponse } from 'msw'
import {
  db,
  getRoomDto,
  getDmThreadBetween,
  canonicalizeFriendPair,
  getFriendship,
  getUserBan,
  getMemberPresence,
  type MockUser,
  type MockMessage,
  type MockDmMessage,
  type MockDmThread,
  type MockRoomBan,
  type MockRoomInvitation,
  type MockSession,
} from './db'

type RegisterBody = { username?: string; email?: string; password?: string }
type LoginBody = { email?: string; password?: string }
type CreateRoomBody = { name?: string; description?: string; isPrivate?: boolean }

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

function requireSession(): MockUser | null {
  if (!db.sessionUserId) return null
  return db.users.find(u => u.id === db.sessionUserId) ?? null
}

function unauthenticated() {
  return HttpResponse.json({ error: 'Unauthenticated' }, { status: 401 })
}

function seedSession(userId: string): void {
  const existing = db.sessions.find(
    s => s.userId === userId && !s.isRevoked,
  )
  if (existing) {
    existing.lastSeenAt = new Date().toISOString()
    return
  }
  const session: MockSession = {
    id: crypto.randomUUID(),
    userId,
    userAgent: 'Mozilla/5.0 (Mock Browser)',
    ipAddress: '127.0.0.1',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    isRevoked: false,
  }
  db.sessions.push(session)
  db.sessionId = session.id
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
    seedSession(user.id)
    return HttpResponse.json({ id: user.id, username: user.username, email: user.email })
  }),

  http.post(`${BASE}/api/auth/logout`, () => {
    if (db.sessionUserId && db.sessionId) {
      const session = db.sessions.find(s => s.id === db.sessionId)
      if (session) session.isRevoked = true
    }
    db.sessionUserId = null
    db.sessionId = null
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

  // ── Sessions ────────────────────────────────────────────────────────────────

  http.get(`${BASE}/api/auth/sessions`, () => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const items = db.sessions
      .filter(s => s.userId === me.id && !s.isRevoked)
      .map(s => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        isCurrent: s.id === db.sessionId,
      }))

    return HttpResponse.json({ items, nextCursor: null })
  }),

  http.post(`${BASE}/api/auth/sessions/:sessionId/revoke`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { sessionId } = params as { sessionId: string }
    const session = db.sessions.find(s => s.id === sessionId && s.userId === me.id)
    if (!session) return HttpResponse.json({ error: 'Session not found' }, { status: 404 })

    session.isRevoked = true
    if (sessionId === db.sessionId) {
      db.sessionUserId = null
      db.sessionId = null
    }
    return HttpResponse.json({})
  }),

  // ── Password ─────────────────────────────────────────────────────────────────

  http.post(`${BASE}/api/auth/change-password`, async ({ request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { currentPassword, newPassword } = (await request.json()) as {
      currentPassword: string
      newPassword: string
    }
    const user = db.users.find(u => u.id === me.id)!
    if (user.password !== currentPassword) {
      return HttpResponse.json({ error: 'Current password incorrect' }, { status: 400 })
    }
    if (newPassword.length < 6) {
      return HttpResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      )
    }
    user.password = newPassword
    return HttpResponse.json({})
  }),

  http.post(`${BASE}/api/auth/forgot-password`, async ({ request }) => {
    const { email } = (await request.json()) as { email: string }
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase())
    const resetToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 3600_000).toISOString()
    if (user) {
      db.passwordResetTokens.push({ token: resetToken, userId: user.id, expiresAt, consumed: false })
    }
    return HttpResponse.json({ resetToken, expiresAt })
  }),

  http.post(`${BASE}/api/auth/reset-password`, async ({ request }) => {
    const { token, newPassword } = (await request.json()) as {
      token: string
      newPassword: string
    }
    const entry = db.passwordResetTokens.find(t => t.token === token && !t.consumed)
    if (!entry || new Date(entry.expiresAt) < new Date()) {
      return HttpResponse.json({ error: 'Token invalid or expired' }, { status: 400 })
    }
    if (newPassword.length < 6) {
      return HttpResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      )
    }
    entry.consumed = true
    const user = db.users.find(u => u.id === entry.userId)
    if (user) user.password = newPassword
    db.sessions.filter(s => s.userId === entry.userId).forEach(s => { s.isRevoked = true })
    return HttpResponse.json({})
  }),

  // ── Account deletion ─────────────────────────────────────────────────────────

  http.delete(`${BASE}/api/auth/me`, async ({ request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { password } = (await request.json()) as { password: string }
    const user = db.users.find(u => u.id === me.id)!
    if (user.password !== password) {
      return HttpResponse.json({ error: 'Password incorrect' }, { status: 400 })
    }

    db.dmThreads
      .filter(t => t.userAId === me.id || t.userBId === me.id)
      .forEach(t => { t.otherPartyDeletedAt = new Date().toISOString() })

    db.users = db.users.filter(u => u.id !== me.id)
    db.sessions.filter(s => s.userId === me.id).forEach(s => { s.isRevoked = true })
    db.friendships = db.friendships.filter(
      f => f.userAId !== me.id && f.userBId !== me.id,
    )
    db.userBans = db.userBans.filter(
      b => b.bannerUserId !== me.id && b.bannedUserId !== me.id,
    )
    for (const [roomId, members] of db.memberships) {
      if (members.get(me.id) === 'owner') {
        db.rooms.delete(roomId)
        db.memberships.delete(roomId)
        db.messages.delete(roomId)
      } else {
        members.delete(me.id)
      }
    }

    db.sessionUserId = null
    db.sessionId = null
    return HttpResponse.json({})
  }),

  // ── Messages (before rooms so /:roomId/messages isn't swallowed by /:roomId) ─

  http.get(`${BASE}/api/rooms/:roomId/messages`, ({ params, request }) => {
    if (!db.sessionUserId) return unauthenticated()

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
      const filtered = all.filter(m => m.watermark > since)
      items = filtered.slice(0, limit)
      nextCursor =
        filtered.length > limit ? String(items[items.length - 1].watermark) : null
    } else {
      const before = beforeParam !== null ? parseInt(beforeParam) : null
      const desc = (before !== null ? all.filter(m => m.watermark < before) : [...all]).reverse()
      items = desc.slice(0, limit)
      nextCursor = desc.length > limit ? String(items[items.length - 1].watermark) : null
    }

    return HttpResponse.json({ items, nextCursor })
  }),

  // ── Message mutations ────────────────────────────────────────────────────────

  http.patch(`${BASE}/api/messages/:messageId`, async ({ params, request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { messageId } = params as { messageId: string }
    const { content } = (await request.json()) as { content: string }

    if (new TextEncoder().encode(content).length > 3072) {
      return HttpResponse.json({ error: 'Message exceeds 3 KB' }, { status: 400 })
    }

    for (const [, msgs] of db.messages) {
      const msg = msgs.find(m => m.id === messageId)
      if (msg) {
        if (msg.authorId !== me.id) {
          return HttpResponse.json({ error: 'Only the author can edit' }, { status: 403 })
        }
        if (msg.deletedAt) {
          return HttpResponse.json({ error: 'Message is deleted' }, { status: 400 })
        }
        msg.content = content
        msg.editedAt = new Date().toISOString()
        return HttpResponse.json(msg)
      }
    }
    return HttpResponse.json({ error: 'Message not found' }, { status: 404 })
  }),

  http.delete(`${BASE}/api/messages/:messageId`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { messageId } = params as { messageId: string }

    for (const [roomId, msgs] of db.messages) {
      const msg = msgs.find(m => m.id === messageId)
      if (msg) {
        const myRole = db.memberships.get(roomId)?.get(me.id)
        const canDelete =
          msg.authorId === me.id || myRole === 'owner' || myRole === 'admin'
        if (!canDelete) {
          return HttpResponse.json(
            { error: 'Insufficient permission to delete' },
            { status: 403 },
          )
        }
        msg.deletedAt = new Date().toISOString()
        msg.content = ''
        return HttpResponse.json({})
      }
    }
    return HttpResponse.json({ error: 'Message not found' }, { status: 404 })
  }),

  // ── Room sub-actions ────────────────────────────────────────────────────────

  http.post(`${BASE}/api/rooms/:roomId/join`, ({ params }) => {
    if (!db.sessionUserId) return unauthenticated()

    const { roomId } = params as { roomId: string }
    const room = db.rooms.get(roomId)
    if (!room) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })

    if (!db.memberships.has(roomId)) db.memberships.set(roomId, new Map())
    const members = db.memberships.get(roomId)!

    if (members.has(db.sessionUserId)) {
      return HttpResponse.json({ error: 'Already a member' }, { status: 409 })
    }

    if (room.isPrivate) {
      const invite = db.roomInvitations.find(
        i =>
          i.roomId === roomId &&
          i.inviteeUserId === db.sessionUserId &&
          i.status === 'pending',
      )
      if (!invite) {
        return HttpResponse.json(
          { error: 'Room is private — join via invitation' },
          { status: 403 },
        )
      }
      invite.status = 'accepted'
      invite.respondedAt = new Date().toISOString()
    }

    members.set(db.sessionUserId, 'member')
    return HttpResponse.json(getRoomDto(roomId, db.sessionUserId))
  }),

  http.post(`${BASE}/api/rooms/:roomId/leave`, ({ params }) => {
    if (!db.sessionUserId) return unauthenticated()

    const { roomId } = params as { roomId: string }
    if (!db.rooms.has(roomId)) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })

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

  // ── Room moderation ──────────────────────────────────────────────────────────

  http.get(`${BASE}/api/rooms/:roomId/members`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId } = params as { roomId: string }
    if (!db.rooms.has(roomId)) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })

    const members = db.memberships.get(roomId)
    if (!members?.has(me.id)) return HttpResponse.json({ error: 'Not a member' }, { status: 403 })

    const items = [...members.entries()].map(([userId, role]) => {
      const user = db.users.find(u => u.id === userId)
      return {
        userId,
        username: user?.username ?? '[deleted]',
        role,
        joinedAt: new Date().toISOString(),
        presence: getMemberPresence(userId),
      }
    })

    return HttpResponse.json({ items, nextCursor: null })
  }),

  http.get(`${BASE}/api/rooms/:roomId/bans`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId } = params as { roomId: string }
    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner' && myRole !== 'admin') {
      return HttpResponse.json({ error: 'Insufficient role' }, { status: 403 })
    }

    const items = db.roomBans
      .filter(b => b.roomId === roomId)
      .map(b => {
        const banned = db.users.find(u => u.id === b.bannedUserId)
        const banner = db.users.find(u => u.id === b.bannedByUserId)
        return {
          userId: b.bannedUserId,
          username: banned?.username ?? '[deleted]',
          bannedByUserId: b.bannedByUserId,
          bannedByUsername: banner?.username ?? '[deleted]',
          bannedAt: b.bannedAt,
          reason: b.reason,
        }
      })

    return HttpResponse.json({ items, nextCursor: null })
  }),

  http.post(`${BASE}/api/rooms/:roomId/members/:userId/promote`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId, userId } = params as { roomId: string; userId: string }
    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner') {
      return HttpResponse.json({ error: 'Only the owner can promote admins' }, { status: 403 })
    }

    const members = db.memberships.get(roomId)
    const targetRole = members?.get(userId)
    if (!targetRole) return HttpResponse.json({ error: 'Member not found' }, { status: 404 })
    if (targetRole === 'admin') {
      return HttpResponse.json({ error: 'User is already an admin' }, { status: 400 })
    }

    members!.set(userId, 'admin')
    return HttpResponse.json({ userId, role: 'admin' })
  }),

  http.post(`${BASE}/api/rooms/:roomId/members/:userId/demote`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId, userId } = params as { roomId: string; userId: string }
    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner') {
      return HttpResponse.json({ error: 'Only the owner can demote admins' }, { status: 403 })
    }

    const members = db.memberships.get(roomId)
    const targetRole = members?.get(userId)
    if (!targetRole) return HttpResponse.json({ error: 'Member not found' }, { status: 404 })
    if (targetRole !== 'admin') {
      return HttpResponse.json({ error: 'User is not an admin' }, { status: 400 })
    }

    members!.set(userId, 'member')
    return HttpResponse.json({ userId, role: 'member' })
  }),

  http.post(`${BASE}/api/rooms/:roomId/members/:userId/ban`, async ({ params, request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId, userId } = params as { roomId: string; userId: string }
    const { reason = null } = ((await request.json().catch(() => ({}))) as { reason?: string | null })

    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner' && myRole !== 'admin') {
      return HttpResponse.json({ error: 'Insufficient role' }, { status: 403 })
    }

    const targetRole = db.memberships.get(roomId)?.get(userId)
    if (!targetRole) return HttpResponse.json({ error: 'User is not a member' }, { status: 400 })

    if (myRole === 'admin' && (targetRole === 'owner' || targetRole === 'admin')) {
      return HttpResponse.json({ error: 'Insufficient role' }, { status: 403 })
    }

    const ban: MockRoomBan = {
      roomId,
      bannedUserId: userId,
      bannedByUserId: me.id,
      bannedAt: new Date().toISOString(),
      reason: reason ?? null,
    }
    db.roomBans.push(ban)
    db.memberships.get(roomId)?.delete(userId)

    return HttpResponse.json({})
  }),

  http.post(`${BASE}/api/rooms/:roomId/members/:userId/unban`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId, userId } = params as { roomId: string; userId: string }
    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner' && myRole !== 'admin') {
      return HttpResponse.json({ error: 'Insufficient role' }, { status: 403 })
    }

    const idx = db.roomBans.findIndex(
      b => b.roomId === roomId && b.bannedUserId === userId,
    )
    if (idx === -1) return HttpResponse.json({ error: 'Ban not found' }, { status: 404 })

    db.roomBans.splice(idx, 1)
    return HttpResponse.json({})
  }),

  // ── Room CRUD ───────────────────────────────────────────────────────────────

  http.delete(`${BASE}/api/rooms/:roomId`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId } = params as { roomId: string }
    const room = db.rooms.get(roomId)
    if (!room) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })

    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner') {
      return HttpResponse.json({ error: 'Only the owner can delete a room' }, { status: 403 })
    }

    db.rooms.delete(roomId)
    db.memberships.delete(roomId)
    db.messages.delete(roomId)
    db.watermarks.delete(roomId)
    db.roomBans = db.roomBans.filter(b => b.roomId !== roomId)
    db.roomInvitations = db.roomInvitations.filter(i => i.roomId !== roomId)

    return HttpResponse.json({})
  }),

  http.get(`${BASE}/api/rooms/:roomId`, ({ params }) => {
    if (!db.sessionUserId) return unauthenticated()

    const { roomId } = params as { roomId: string }
    const dto = getRoomDto(roomId, db.sessionUserId)
    if (!dto) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })

    return HttpResponse.json(dto)
  }),

  http.get(`${BASE}/api/rooms`, ({ request }) => {
    if (!db.sessionUserId) return unauthenticated()

    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    const cursor = url.searchParams.get('cursor')
    const limitParam = parseInt(url.searchParams.get('limit') ?? '')
    const limit = Math.min(Number.isNaN(limitParam) ? 20 : limitParam, 50)

    const sorted = [...db.rooms.values()].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name)
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
    })

    const visible = sorted.filter(r => {
      if (!r.isPrivate) return true
      const isMember = db.memberships.get(r.id)?.has(db.sessionUserId!) ?? false
      if (isMember) return true
      const hasPendingInvite = db.roomInvitations.some(
        i =>
          i.roomId === r.id &&
          i.inviteeUserId === db.sessionUserId &&
          i.status === 'pending',
      )
      return hasPendingInvite
    })

    const searched = q
      ? visible.filter(r => r.name.toLowerCase().includes(q.toLowerCase()))
      : visible

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
    if (!db.sessionUserId) return unauthenticated()

    const body = (await request.json()) as CreateRoomBody
    const name = (body.name ?? '').trim()
    const description = (body.description ?? '').trim()
    const isPrivate = body.isPrivate ?? false

    if (!name) return HttpResponse.json({ error: 'Name is required' }, { status: 400 })

    if ([...db.rooms.values()].some(r => r.name.toLowerCase() === name.toLowerCase())) {
      return HttpResponse.json({ error: 'Room name already taken' }, { status: 409 })
    }

    const id = crypto.randomUUID()
    db.rooms.set(id, { id, name, description, createdById: db.sessionUserId, isPrivate })
    db.memberships.set(id, new Map([[db.sessionUserId, 'owner']]))
    db.watermarks.set(id, 0)
    db.messages.set(id, [])

    return HttpResponse.json(getRoomDto(id, db.sessionUserId), { status: 201 })
  }),

  // ── Room invitations ─────────────────────────────────────────────────────────

  http.post(`${BASE}/api/rooms/:roomId/invitations`, async ({ params, request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { roomId } = params as { roomId: string }
    const room = db.rooms.get(roomId)
    if (!room) return HttpResponse.json({ error: 'Room not found' }, { status: 404 })
    if (!room.isPrivate) {
      return HttpResponse.json(
        { error: 'Public rooms do not use invitations' },
        { status: 400 },
      )
    }

    const myRole = db.memberships.get(roomId)?.get(me.id)
    if (myRole !== 'owner' && myRole !== 'admin') {
      return HttpResponse.json(
        { error: 'Only owner or admin can invite' },
        { status: 403 },
      )
    }

    const { username } = (await request.json()) as { username: string }
    const target = db.users.find(u => u.username.toLowerCase() === username.toLowerCase())
    if (!target) return HttpResponse.json({ error: 'User not found' }, { status: 404 })

    if (db.memberships.get(roomId)?.has(target.id)) {
      return HttpResponse.json({ error: 'User is already a member' }, { status: 400 })
    }

    const existing = db.roomInvitations.find(
      i => i.roomId === roomId && i.inviteeUserId === target.id && i.status === 'pending',
    )
    if (existing) {
      return HttpResponse.json({ error: 'Invitation already pending' }, { status: 400 })
    }

    const invite: MockRoomInvitation = {
      id: crypto.randomUUID(),
      roomId,
      inviteeUserId: target.id,
      invitedByUserId: me.id,
      createdAt: new Date().toISOString(),
      status: 'pending',
      respondedAt: null,
    }
    db.roomInvitations.push(invite)

    return HttpResponse.json(
      {
        id: invite.id,
        roomId,
        inviteeUserId: target.id,
        inviteeUsername: target.username,
        status: 'pending',
        createdAt: invite.createdAt,
      },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/api/invitations`, () => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const items = db.roomInvitations
      .filter(i => i.inviteeUserId === me.id && i.status === 'pending')
      .map(i => {
        const room = db.rooms.get(i.roomId)
        const inviter = db.users.find(u => u.id === i.invitedByUserId)
        return {
          id: i.id,
          roomId: i.roomId,
          roomName: room?.name ?? '[deleted]',
          invitedByUsername: inviter?.username ?? '[deleted]',
          createdAt: i.createdAt,
        }
      })

    return HttpResponse.json({ items, nextCursor: null })
  }),

  http.post(`${BASE}/api/invitations/:invitationId/accept`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { invitationId } = params as { invitationId: string }
    const invite = db.roomInvitations.find(
      i => i.id === invitationId && i.inviteeUserId === me.id,
    )
    if (!invite) return HttpResponse.json({ error: 'Invitation not found' }, { status: 404 })
    if (invite.status !== 'pending') {
      return HttpResponse.json({ error: 'Invitation is not pending' }, { status: 400 })
    }

    invite.status = 'accepted'
    invite.respondedAt = new Date().toISOString()

    if (!db.memberships.has(invite.roomId)) db.memberships.set(invite.roomId, new Map())
    db.memberships.get(invite.roomId)!.set(me.id, 'member')

    return HttpResponse.json(getRoomDto(invite.roomId, me.id))
  }),

  http.post(`${BASE}/api/invitations/:invitationId/decline`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { invitationId } = params as { invitationId: string }
    const invite = db.roomInvitations.find(
      i => i.id === invitationId && i.inviteeUserId === me.id,
    )
    if (!invite) return HttpResponse.json({ error: 'Invitation not found' }, { status: 404 })

    invite.status = 'declined'
    invite.respondedAt = new Date().toISOString()
    return HttpResponse.json({})
  }),

  // ── Friends ──────────────────────────────────────────────────────────────────

  http.get(`${BASE}/api/friends`, () => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const items = db.friendships
      .filter(
        f =>
          (f.userAId === me.id || f.userBId === me.id) && f.status === 'accepted',
      )
      .map(f => {
        const otherId = f.userAId === me.id ? f.userBId : f.userAId
        const other = db.users.find(u => u.id === otherId)
        const thread = getDmThreadBetween(me.id, otherId)
        return {
          userId: otherId,
          username: other?.username ?? '[deleted]',
          acceptedAt: f.acceptedAt ?? f.requestedAt,
          presence: getMemberPresence(otherId),
          isBanned: getUserBan(me.id, otherId) !== null,
          isBannedBy: getUserBan(otherId, me.id) !== null,
          dmThreadId: thread?.id ?? null,
        }
      })

    return HttpResponse.json({ items, nextCursor: null })
  }),

  http.post(`${BASE}/api/friends/requests`, async ({ request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { username, message = null } = (await request.json()) as {
      username: string
      message?: string | null
    }

    const target = db.users.find(u => u.username.toLowerCase() === username.toLowerCase())
    if (!target) return HttpResponse.json({ error: 'User not found' }, { status: 404 })
    if (target.id === me.id) {
      return HttpResponse.json({ error: 'Cannot friend yourself' }, { status: 400 })
    }
    if (getUserBan(target.id, me.id)) {
      return HttpResponse.json({ error: 'User has banned you' }, { status: 400 })
    }

    const existing = getFriendship(me.id, target.id)
    if (existing) {
      if (existing.status === 'accepted') {
        return HttpResponse.json({ error: 'Already friends' }, { status: 400 })
      }
      return HttpResponse.json({ error: 'Friend request already pending' }, { status: 400 })
    }

    const [a, b] = canonicalizeFriendPair(me.id, target.id)
    db.friendships.push({
      userAId: a,
      userBId: b,
      status: 'pending',
      requestedByUserId: me.id,
      requestedAt: new Date().toISOString(),
      acceptedAt: null,
      requestMessage: message ?? null,
    })

    return HttpResponse.json({ username: target.username, status: 'pending' }, { status: 201 })
  }),

  http.get(`${BASE}/api/friends/requests`, () => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const incoming = db.friendships
      .filter(
        f =>
          (f.userAId === me.id || f.userBId === me.id) &&
          f.status === 'pending' &&
          f.requestedByUserId !== me.id,
      )
      .map(f => {
        const otherId = f.requestedByUserId
        const other = db.users.find(u => u.id === otherId)
        return {
          userId: otherId,
          username: other?.username ?? '[deleted]',
          message: f.requestMessage,
          requestedAt: f.requestedAt,
        }
      })

    const outgoing = db.friendships
      .filter(
        f =>
          (f.userAId === me.id || f.userBId === me.id) &&
          f.status === 'pending' &&
          f.requestedByUserId === me.id,
      )
      .map(f => {
        const otherId = f.userAId === me.id ? f.userBId : f.userAId
        const other = db.users.find(u => u.id === otherId)
        return {
          userId: otherId,
          username: other?.username ?? '[deleted]',
          requestedAt: f.requestedAt,
        }
      })

    return HttpResponse.json({ incoming, outgoing })
  }),

  http.post(`${BASE}/api/friends/requests/:userId/accept`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { userId } = params as { userId: string }
    const friendship = getFriendship(me.id, userId)
    if (!friendship || friendship.status !== 'pending' || friendship.requestedByUserId === me.id) {
      return HttpResponse.json({ error: 'Friend request not found' }, { status: 404 })
    }

    friendship.status = 'accepted'
    friendship.acceptedAt = new Date().toISOString()

    const other = db.users.find(u => u.id === userId)
    return HttpResponse.json({ userId, username: other?.username ?? '[deleted]' })
  }),

  http.post(`${BASE}/api/friends/requests/:userId/decline`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { userId } = params as { userId: string }
    const [a, b] = canonicalizeFriendPair(me.id, userId)
    const idx = db.friendships.findIndex(
      f => f.userAId === a && f.userBId === b && f.status === 'pending',
    )
    if (idx !== -1) db.friendships.splice(idx, 1)
    return HttpResponse.json({})
  }),

  http.delete(`${BASE}/api/friends/:userId`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { userId } = params as { userId: string }
    const [a, b] = canonicalizeFriendPair(me.id, userId)
    const idx = db.friendships.findIndex(f => f.userAId === a && f.userBId === b)
    if (idx !== -1) db.friendships.splice(idx, 1)
    return HttpResponse.json({})
  }),

  http.post(`${BASE}/api/friends/:userId/ban`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { userId } = params as { userId: string }
    if (!getUserBan(me.id, userId)) {
      db.userBans.push({ bannerUserId: me.id, bannedUserId: userId, bannedAt: new Date().toISOString() })
    }

    const thread = getDmThreadBetween(me.id, userId)
    if (thread) thread.frozenAt = new Date().toISOString()

    return HttpResponse.json({})
  }),

  http.delete(`${BASE}/api/friends/:userId/ban`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { userId } = params as { userId: string }
    const idx = db.userBans.findIndex(b => b.bannerUserId === me.id && b.bannedUserId === userId)
    if (idx !== -1) db.userBans.splice(idx, 1)

    const reverseban = getUserBan(userId, me.id)
    if (!reverseban) {
      const thread = getDmThreadBetween(me.id, userId)
      if (thread) thread.frozenAt = null
    }

    return HttpResponse.json({})
  }),

  // ── Direct Messages ──────────────────────────────────────────────────────────

  http.post(`${BASE}/api/dms/open`, async ({ request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { userId } = (await request.json()) as { userId: string }

    const friendship = getFriendship(me.id, userId)
    if (!friendship || friendship.status !== 'accepted') {
      return HttpResponse.json({ error: 'Not friends' }, { status: 403 })
    }
    if (getUserBan(me.id, userId) || getUserBan(userId, me.id)) {
      return HttpResponse.json({ error: 'User banned' }, { status: 403 })
    }

    let thread = getDmThreadBetween(me.id, userId)
    if (!thread) {
      const [a, b] = canonicalizeFriendPair(me.id, userId)
      const newThread: MockDmThread = {
        id: crypto.randomUUID(),
        userAId: a,
        userBId: b,
        createdAt: new Date().toISOString(),
        currentWatermark: 0,
        frozenAt: null,
        otherPartyDeletedAt: null,
      }
      db.dmThreads.push(newThread)
      db.dmMessages.set(newThread.id, [])
      db.dmWatermarks.set(newThread.id, 0)
      thread = newThread
    }

    const other = db.users.find(u => u.id === userId)
    return HttpResponse.json({
      id: thread.id,
      otherUser: {
        userId,
        username: other?.username ?? '[deleted]',
        presence: getMemberPresence(userId),
      },
      frozenAt: thread.frozenAt,
      otherPartyDeletedAt: thread.otherPartyDeletedAt,
      currentWatermark: db.dmWatermarks.get(thread.id) ?? 0,
    })
  }),

  http.get(`${BASE}/api/dms`, () => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const items = db.dmThreads
      .filter(t => t.userAId === me.id || t.userBId === me.id)
      .map(t => {
        const otherId = t.userAId === me.id ? t.userBId : t.userAId
        const other = db.users.find(u => u.id === otherId)
        const msgs = db.dmMessages.get(t.id) ?? []
        const last = msgs[msgs.length - 1]
        const unread = db.dmUnreads.get(me.id)?.get(t.id) ?? 0
        return {
          id: t.id,
          otherUser: {
            userId: otherId,
            username: other?.username ?? '[deleted]',
            presence: getMemberPresence(otherId),
          },
          lastMessagePreview: last ? last.content.slice(0, 80) : null,
          lastActivityAt: last?.sentAt ?? t.createdAt,
          unreadCount: unread,
          frozenAt: t.frozenAt,
          otherPartyDeletedAt: t.otherPartyDeletedAt,
        }
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))

    return HttpResponse.json({ items, nextCursor: null })
  }),

  http.get(`${BASE}/api/dms/:threadId`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { threadId } = params as { threadId: string }
    const thread = db.dmThreads.find(t => t.id === threadId)
    if (!thread) return HttpResponse.json({ error: 'Thread not found' }, { status: 404 })
    if (thread.userAId !== me.id && thread.userBId !== me.id) {
      return HttpResponse.json({ error: 'Not a participant' }, { status: 403 })
    }

    const otherId = thread.userAId === me.id ? thread.userBId : thread.userAId
    const other = db.users.find(u => u.id === otherId)

    return HttpResponse.json({
      id: thread.id,
      otherUser: {
        userId: otherId,
        username: other?.username ?? '[deleted]',
        presence: getMemberPresence(otherId),
      },
      frozenAt: thread.frozenAt,
      otherPartyDeletedAt: thread.otherPartyDeletedAt,
      currentWatermark: db.dmWatermarks.get(thread.id) ?? 0,
    })
  }),

  http.get(`${BASE}/api/dms/:threadId/messages`, ({ params, request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { threadId } = params as { threadId: string }
    const thread = db.dmThreads.find(t => t.id === threadId)
    if (!thread) return HttpResponse.json({ error: 'Thread not found' }, { status: 404 })
    if (thread.userAId !== me.id && thread.userBId !== me.id) {
      return HttpResponse.json({ error: 'Not a participant' }, { status: 403 })
    }

    const url = new URL(request.url)
    const beforeParam = url.searchParams.get('before')
    const sinceParam = url.searchParams.get('since')
    const limitParam = parseInt(url.searchParams.get('limit') ?? '')
    const limit = Math.min(Number.isNaN(limitParam) ? 50 : limitParam, 50)

    const all = db.dmMessages.get(threadId) ?? []
    let items: MockDmMessage[]
    let nextCursor: string | null

    if (sinceParam !== null) {
      const since = parseInt(sinceParam)
      const filtered = all.filter(m => m.watermark > since)
      items = filtered.slice(0, limit)
      nextCursor = filtered.length > limit ? String(items[items.length - 1].watermark) : null
    } else {
      const before = beforeParam !== null ? parseInt(beforeParam) : null
      const desc = (before !== null ? all.filter(m => m.watermark < before) : [...all]).reverse()
      items = desc.slice(0, limit)
      nextCursor = desc.length > limit ? String(items[items.length - 1].watermark) : null
    }

    return HttpResponse.json({ items, nextCursor })
  }),

  // ── Files ─────────────────────────────────────────────────────────────────────

  http.post(`${BASE}/api/files`, async ({ request }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const form = await request.formData()
    const file = form.get('file') as File | null
    const scope = (form.get('scope') as string) ?? 'room'
    const scopeId = (form.get('scopeId') as string) ?? ''

    if (!file) return HttpResponse.json({ error: 'No file' }, { status: 400 })
    if (!scopeId) return HttpResponse.json({ error: 'Scope id required' }, { status: 400 })

    const isImage = file.type.startsWith('image/')
    const maxBytes = isImage ? 3 * 1024 * 1024 : 20 * 1024 * 1024
    if (file.size > maxBytes) {
      return HttpResponse.json(
        { error: isImage ? 'Image exceeds 3 MB' : 'File exceeds 20 MB' },
        { status: 413 },
      )
    }

    const id = crypto.randomUUID()
    db.fileAttachments.push({
      id,
      uploaderId: me.id,
      originalFilename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      storagePath: `/mock/${id}`,
      createdAt: new Date().toISOString(),
      roomId: scope === 'room' ? scopeId : null,
      dmThreadId: scope === 'dm' ? scopeId : null,
      messageId: null,
      dmMessageId: null,
    })

    return HttpResponse.json(
      { id, originalFilename: file.name, contentType: file.type, sizeBytes: file.size, scope, scopeId },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/api/files/:fileId`, ({ params }) => {
    const me = requireSession()
    if (!me) return unauthenticated()

    const { fileId } = params as { fileId: string }
    const attachment = db.fileAttachments.find(f => f.id === fileId)
    if (!attachment) return HttpResponse.json({ error: 'File not found' }, { status: 404 })

    if (attachment.roomId) {
      const isMember = db.memberships.get(attachment.roomId)?.has(me.id)
      const isUploader = attachment.uploaderId === me.id
      if (!isMember && !isUploader) {
        return HttpResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }
    if (attachment.dmThreadId) {
      const thread = db.dmThreads.find(t => t.id === attachment.dmThreadId)
      const isParticipant = thread && (thread.userAId === me.id || thread.userBId === me.id)
      if (!isParticipant && attachment.uploaderId !== me.id) {
        return HttpResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // In MSW, return a tiny 1x1 transparent PNG for image types, or plain text otherwise
    if (attachment.contentType.startsWith('image/')) {
      const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,0,0,0,12,73,68,65,84,8,215,99,248,207,192,0,0,0,2,0,1,226,33,188,51,0,0,0,0,73,69,78,68,174,66,96,130])
      return new HttpResponse(png, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `inline; filename="${attachment.originalFilename}"`,
        },
      })
    }

    return new HttpResponse(attachment.originalFilename, {
      headers: {
        'Content-Type': attachment.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${attachment.originalFilename}"`,
      },
    })
  }),
]
