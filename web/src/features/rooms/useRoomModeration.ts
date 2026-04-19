import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { RoomMembersResponse, RoomBansResponse } from './types'

export function useRoomMembers(roomId: string) {
  return useQuery({
    queryKey: ['room-members', roomId],
    queryFn: () => api.get<RoomMembersResponse>(`/api/rooms/${roomId}/members`),
    enabled: !!roomId,
  })
}

export function useRoomBans(roomId: string) {
  return useQuery({
    queryKey: ['room-bans', roomId],
    queryFn: () => api.get<RoomBansResponse>(`/api/rooms/${roomId}/bans`),
    enabled: !!roomId,
  })
}

export function usePromoteMember(roomId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/rooms/${roomId}/members/${userId}/promote`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-members', roomId] })
    },
  })
}

export function useDemoteMember(roomId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/rooms/${roomId}/members/${userId}/demote`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-members', roomId] })
    },
  })
}

export function useBanMember(roomId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string | null }) =>
      api.post(`/api/rooms/${roomId}/members/${userId}/ban`, { reason: reason ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-members', roomId] })
      qc.invalidateQueries({ queryKey: ['room-bans', roomId] })
    },
  })
}

export function useUnbanMember(roomId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/rooms/${roomId}/members/${userId}/unban`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-bans', roomId] })
    },
  })
}

export function useDeleteRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roomId: string) => api.delete(`/api/rooms/${roomId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms'] })
    },
  })
}
