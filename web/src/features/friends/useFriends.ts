import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { FriendDto, FriendRequestsResponse, SendFriendRequestResponse } from './types'
import type { PresenceStatus } from '@/features/presence/usePresence'

type FriendsListResponse = {
  items: FriendDto[]
  nextCursor: string | null
}

export function useFriends() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<FriendsListResponse>('/api/friends'),
  })

  const friends = query.data?.items
  useEffect(() => {
    if (!friends) return
    for (const f of friends) {
      qc.setQueryData<PresenceStatus>(['presence', f.userId], f.presence)
    }
  }, [friends, qc])

  return query
}

export function useFriendRequests() {
  return useQuery({
    queryKey: ['friend-requests'],
    queryFn: () => api.get<FriendRequestsResponse>('/api/friends/requests'),
  })
}

export function useSendFriendRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ username, message }: { username: string; message?: string }) =>
      api.post<SendFriendRequestResponse>('/api/friends/requests', { username, message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friend-requests'] }),
  })
}

export function useAcceptFriendRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.post<Record<string, never>>(`/api/friends/requests/${userId}/accept`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
      qc.invalidateQueries({ queryKey: ['friends'] })
    },
  })
}

export function useDeclineFriendRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.post<Record<string, never>>(`/api/friends/requests/${userId}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friend-requests'] }),
  })
}

export function useRemoveFriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.delete<Record<string, never>>(`/api/friends/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  })
}

export function useBanUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.post<Record<string, never>>(`/api/friends/${userId}/ban`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    },
  })
}

export function useUnbanUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.delete<Record<string, never>>(`/api/friends/${userId}/ban`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    },
  })
}
