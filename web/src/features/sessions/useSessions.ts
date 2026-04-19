import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { queryClient as qc } from '@/lib/queryClient'
import type { SessionsResponse } from './types'

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionsResponse>('/api/auth/sessions'),
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ isCurrent?: boolean }>(`/api/auth/sessions/${sessionId}/revoke`),
    onSuccess: (_data, sessionId) => {
      queryClient.setQueryData<SessionsResponse>(['sessions'], old => {
        if (!old) return old
        const wasCurrentSession = old.items.find(s => s.id === sessionId)?.isCurrent
        if (wasCurrentSession) {
          qc.clear()
          navigate('/login')
          return old
        }
        return { ...old, items: old.items.filter(s => s.id !== sessionId) }
      })
    },
  })
}
