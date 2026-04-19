export type SessionDto = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  lastSeenAt: string
  isCurrent: boolean
}

export type SessionsResponse = {
  items: SessionDto[]
  nextCursor: string | null
}
