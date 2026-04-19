export type RoomRole = 'owner' | 'admin' | 'member'
export type PresenceStatus = 'online' | 'afk' | 'offline'
export type FriendshipStatus = 'pending' | 'accepted'
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked'

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
  authorId: string | null
  authorUsername: string
  content: string
  sentAt: string
  idempotencyKey: string
  watermark: number
  editedAt: string | null
  deletedAt: string | null
  replyToMessageId: string | null
  attachments: MockFileAttachment[]
}

export type MockDmMessage = {
  id: string
  dmThreadId: string
  authorId: string | null
  authorUsername: string
  content: string
  sentAt: string
  idempotencyKey: string
  watermark: number
  editedAt: string | null
  deletedAt: string | null
  replyToMessageId: string | null
  attachments: MockFileAttachment[]
}

export type MockDmThread = {
  id: string
  userAId: string
  userBId: string
  createdAt: string
  currentWatermark: number
  frozenAt: string | null
  otherPartyDeletedAt: string | null
}

export type MockFriendship = {
  userAId: string
  userBId: string
  status: FriendshipStatus
  requestedByUserId: string
  requestedAt: string
  acceptedAt: string | null
  requestMessage: string | null
}

export type MockUserBan = {
  bannerUserId: string
  bannedUserId: string
  bannedAt: string
}

export type MockRoomBan = {
  roomId: string
  bannedUserId: string
  bannedByUserId: string | null
  bannedAt: string
  reason: string | null
}

export type MockRoomInvitation = {
  id: string
  roomId: string
  inviteeUserId: string
  invitedByUserId: string
  createdAt: string
  status: InvitationStatus
  respondedAt: string | null
}

export type MockFileAttachment = {
  id: string
  uploaderId: string | null
  originalFilename: string
  contentType: string
  sizeBytes: number
  storagePath: string
  createdAt: string
  roomId: string | null
  dmThreadId: string | null
  messageId: string | null
  dmMessageId: string | null
}

export type MockSession = {
  id: string
  userId: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  lastSeenAt: string
  isRevoked: boolean
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

export type MockPasswordResetToken = {
  token: string
  userId: string
  expiresAt: string
  consumed: boolean
}

export const db = {
  users: [] as MockUser[],
  sessionUserId: null as string | null,
  sessionId: null as string | null,
  rooms: new Map<string, MockRoom>(),
  memberships: new Map<string, Map<string, RoomRole>>(),
  messages: new Map<string, MockMessage[]>(),
  watermarks: new Map<string, number>(),
  presence: new Map<string, PresenceStatus>(),
  pendingSends: new Map<string, MockMessage>(),

  // Phase 2 state
  passwordResetTokens: [] as MockPasswordResetToken[],
  friendships: [] as MockFriendship[],
  userBans: [] as MockUserBan[],
  dmThreads: [] as MockDmThread[],
  dmMessages: new Map<string, MockDmMessage[]>(),
  dmWatermarks: new Map<string, number>(),
  dmUnreads: new Map<string, Map<string, number>>(),
  roomBans: [] as MockRoomBan[],
  roomInvitations: [] as MockRoomInvitation[],
  fileAttachments: [] as MockFileAttachment[],
  sessions: [] as MockSession[],
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

export function nextDmWatermark(threadId: string): number {
  const next = (db.dmWatermarks.get(threadId) ?? 0) + 1
  db.dmWatermarks.set(threadId, next)
  return next
}

// Returns a canonical DmThread id for a user pair (always userA < userB).
export function getDmThreadBetween(userIdA: string, userIdB: string): MockDmThread | null {
  const [a, b] = [userIdA, userIdB].sort()
  return db.dmThreads.find(t => t.userAId === a && t.userBId === b) ?? null
}

export function canonicalizeFriendPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x]
}

export function getFriendship(x: string, y: string): MockFriendship | null {
  const [a, b] = canonicalizeFriendPair(x, y)
  return db.friendships.find(f => f.userAId === a && f.userBId === b) ?? null
}

export function getUserBan(bannerUserId: string, bannedUserId: string): MockUserBan | null {
  return db.userBans.find(b => b.bannerUserId === bannerUserId && b.bannedUserId === bannedUserId) ?? null
}

export function getMemberPresence(userId: string): PresenceStatus {
  return db.presence.get(userId) ?? 'offline'
}
