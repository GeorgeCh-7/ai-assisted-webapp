import { useEffect } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { RoomDto, PagedRoomsResponse } from './types'
import type { PresenceStatus } from '@/features/presence/usePresence'

type MemberDto = {
  userId: string
  username: string
  role: string
  joinedAt: string
  presence: PresenceStatus
}

type MembersResponse = {
  items: MemberDto[]
  nextCursor: string | null
}

export function useRooms(q = '', onlyPrivate = false, mine = false) {
  return useInfiniteQuery({
    queryKey: ['rooms', q, onlyPrivate, mine],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' })
      if (q) params.set('q', q)
      if (mine) params.set('mine', 'true')
      else if (onlyPrivate) params.set('private', 'true')
      if (pageParam) params.set('cursor', pageParam)
      return api.get<PagedRoomsResponse>(`/api/rooms?${params}`)
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
  })
}

export function useRoom(id: string) {
  return useQuery({
    queryKey: ['room', id],
    queryFn: () => api.get<RoomDto>(`/api/rooms/${id}`),
    enabled: !!id,
  })
}

export function useJoinRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roomId: string) => api.post<RoomDto>(`/api/rooms/${roomId}/join`),
    onSuccess: room => {
      qc.setQueryData(['room', room.id], room)
      qc.invalidateQueries({ queryKey: ['rooms'] })
    },
  })
}

export function useLeaveRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roomId: string) =>
      api.post<Record<string, never>>(`/api/rooms/${roomId}/leave`),
    onSuccess: (_, roomId) => {
      qc.invalidateQueries({ queryKey: ['rooms'] })
      qc.invalidateQueries({ queryKey: ['room', roomId] })
    },
  })
}

export function useRoomMembers(roomId: string) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['room-members', roomId],
    queryFn: () => api.get<MembersResponse>(`/api/rooms/${roomId}/members`),
    enabled: !!roomId,
  })
  const members = query.data?.items
  useEffect(() => {
    if (!members) return
    for (const m of members) {
      qc.setQueryData<PresenceStatus>(['presence', m.userId], m.presence)
    }
  }, [members, qc])
  return query
}

export function useCreateRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description: string; isPrivate?: boolean }) =>
      api.post<RoomDto>('/api/rooms', data),
    onSuccess: room => {
      qc.setQueryData(['room', room.id], room)
      qc.invalidateQueries({ queryKey: ['rooms'] })
    },
  })
}
