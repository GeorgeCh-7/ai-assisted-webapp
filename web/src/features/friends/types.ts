import type { PresenceStatus } from '@/features/presence/usePresence'

export type FriendDto = {
  userId: string
  username: string
  acceptedAt: string
  presence: PresenceStatus
  isBanned: boolean
  isBannedBy: boolean
  dmThreadId: string | null
}

export type IncomingFriendRequest = {
  userId: string
  username: string
  message: string | null
  requestedAt: string
}

export type OutgoingFriendRequest = {
  userId: string
  username: string
  requestedAt: string
}

export type FriendRequestsResponse = {
  incoming: IncomingFriendRequest[]
  outgoing: OutgoingFriendRequest[]
}

export type SendFriendRequestResponse = {
  username: string
  status: string
}
