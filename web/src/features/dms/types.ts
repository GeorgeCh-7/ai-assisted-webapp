import type { PresenceStatus } from '@/features/presence/usePresence'
import type { FileAttachmentDto } from '@/features/chat/types'

export type DmOtherUser = {
  userId: string
  username: string
  presence: PresenceStatus
}

export type DmThreadDto = {
  id: string
  otherUser: DmOtherUser
  frozenAt: string | null
  otherPartyDeletedAt: string | null
  currentWatermark: number
}

export type DmThreadListItem = {
  id: string
  otherUser: DmOtherUser
  lastMessagePreview: string | null
  lastActivityAt: string
  unreadCount: number
  frozenAt: string | null
  otherPartyDeletedAt: string | null
}

export type DmMessageDto = {
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
  attachments: FileAttachmentDto[]
}

export type PagedDmMessagesResponse = {
  items: DmMessageDto[]
  nextCursor: string | null
}

export type PagedDmThreadsResponse = {
  items: DmThreadListItem[]
  nextCursor: string | null
}
