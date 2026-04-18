export type MessageDto = {
  id: string
  roomId: string
  authorId: string
  authorUsername: string
  content: string
  sentAt: string
  idempotencyKey: string
  watermark: number
  // Reserved for Phase 2 — always null in Phase 1; types included so Phase 2
  // consumers don't widen the contract on first use
  editedAt: string | null
  deletedAt: string | null
  replyToMessageId: string | null
}

export type PagedMessagesResponse = {
  items: MessageDto[]
  nextCursor: string | null
}

export type OptimisticMessage = MessageDto & { pending: true }
