export type RoomRole = 'owner' | 'member'
export type PresenceStatus = 'online' | 'afk' | 'offline'

export type MockUser = {
  id: string
  username: string
  email: string
  password: string
}

export type MockRoom = {
  id: string
  name: string
  description: string
  createdById: string
  isPrivate: boolean
}

export type MockMessage = {
  id: string
  roomId: string
  authorId: string
  authorUsername: string
  content: string
  sentAt: string
  idempotencyKey: string
  watermark: number
  editedAt: null
  deletedAt: null
  replyToMessageId: null
}

export type RoomDto = {
  id: string
  name: string
  description: string
  memberCount: number
  isMember: boolean
  isPrivate: boolean
  myRole: RoomRole | null
}

export const db = {
  users: [] as MockUser[],
  sessionUserId: null as string | null,
  rooms: new Map<string, MockRoom>(),
  memberships: new Map<string, Map<string, RoomRole>>(),
  messages: new Map<string, MockMessage[]>(),
  watermarks: new Map<string, number>(),
  presence: new Map<string, PresenceStatus>(),
  // Guards concurrent SendMessage invokes with the same idempotencyKey — set before
  // insert, checked before any new insert, so all concurrent callers get the same message
  pendingSends: new Map<string, MockMessage>(),
}

export function getCurrentUser(): MockUser | null {
  if (!db.sessionUserId) return null
  return db.users.find(u => u.id === db.sessionUserId) ?? null
}

export function getRoomDto(roomId: string, userId: string | null): RoomDto | null {
  const room = db.rooms.get(roomId)
  if (!room) return null
  const members = db.memberships.get(roomId) ?? new Map<string, RoomRole>()
  const role = userId ? (members.get(userId) ?? null) : null
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    memberCount: members.size,
    isMember: role !== null,
    isPrivate: room.isPrivate,
    myRole: role,
  }
}

export function nextWatermark(roomId: string): number {
  const next = (db.watermarks.get(roomId) ?? 0) + 1
  db.watermarks.set(roomId, next)
  return next
}
