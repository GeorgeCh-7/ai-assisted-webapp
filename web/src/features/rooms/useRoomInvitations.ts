import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { InvitationsInboxResponse, RoomDto } from './types'

export function useInvitations() {
  return useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<InvitationsInboxResponse>('/api/invitations'),
  })
}

export function useAcceptInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) =>
      api.post<RoomDto>(`/api/invitations/${invitationId}/accept`),
    onSuccess: room => {
      qc.invalidateQueries({ queryKey: ['invitations'] })
      qc.invalidateQueries({ queryKey: ['rooms'] })
      qc.setQueryData(['room', room.id], room)
    },
  })
}

export function useDeclineInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) =>
      api.post<object>(`/api/invitations/${invitationId}/decline`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations'] })
    },
  })
}

export function useSendInvitation(roomId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (username: string) =>
      api.post(`/api/rooms/${roomId}/invitations`, { username }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-invitations-sent', roomId] })
    },
  })
}
