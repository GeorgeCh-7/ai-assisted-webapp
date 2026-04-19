import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { RoomDto, PagedRoomsResponse } from './types'

export function useRooms(q = '') {
  return useInfiniteQuery({
    queryKey: ['rooms', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' })
      if (q) params.set('q', q)
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
