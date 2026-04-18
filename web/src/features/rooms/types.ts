export type RoomRole = 'owner' | 'member'

export type RoomDto = {
  id: string
  name: string
  description: string
  memberCount: number
  isMember: boolean
  isPrivate: boolean
  myRole: RoomRole | null
}

export type PagedRoomsResponse = {
  items: RoomDto[]
  nextCursor: string | null
}
