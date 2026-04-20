export type RoomRole = 'owner' | 'admin' | 'member'

export type RoomDto = {
  id: string
  name: string
  description: string
  memberCount: number
  isMember: boolean
  isPrivate: boolean
  myRole: RoomRole | null
  isBanned: boolean
}

export type PagedRoomsResponse = {
  items: RoomDto[]
  nextCursor: string | null
}

export type RoomMemberDto = {
  userId: string
  username: string
  role: RoomRole
  joinedAt: string
  presence: 'online' | 'afk' | 'offline'
}

export type RoomMembersResponse = {
  items: RoomMemberDto[]
  nextCursor: string | null
}

export type RoomBanDto = {
  userId: string
  username: string
  bannedByUserId: string | null
  bannedByUsername: string
  bannedAt: string
  reason: string | null
}

export type RoomBansResponse = {
  items: RoomBanDto[]
  nextCursor: string | null
}

export type RoomInvitationSentDto = {
  id: string
  roomId: string
  inviteeUserId: string
  inviteeUsername: string
  status: string
  createdAt: string
}

export type InvitationInboxItem = {
  id: string
  roomId: string
  roomName: string
  invitedByUsername: string
  createdAt: string
}

export type InvitationsInboxResponse = {
  items: InvitationInboxItem[]
  nextCursor: string | null
}
