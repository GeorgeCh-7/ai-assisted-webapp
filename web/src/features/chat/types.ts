export type FileAttachmentDto = {
  id: string
  originalFilename: string
  contentType: string
  sizeBytes: number
}

export type MessageDto = {
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
  attachments: FileAttachmentDto[]
}

export type PagedMessagesResponse = {
  items: MessageDto[]
  nextCursor: string | null
}

export type OptimisticMessage = MessageDto & { pending: true }
