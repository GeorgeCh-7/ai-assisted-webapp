import { useCallback } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

export function useUnreadCount(roomId: string) {
  const { data = 0 } = useQuery<number>({
    queryKey: ['unread', roomId],
    queryFn: () => Promise.resolve(0),
    staleTime: Infinity,
    enabled: !!roomId,
  })
  return data
}

export function useMarkRoomRead(roomId: string) {
  const qc = useQueryClient()
  return useCallback(() => {
    qc.setQueryData<number>(['unread', roomId], 0)
  }, [qc, roomId])
}

// Called from useSignalR's handleMessage — not a hook, just a cache writer.
export function incrementUnread(qc: QueryClient, roomId: string) {
  qc.setQueryData<number>(['unread', roomId], prev => (prev ?? 0) + 1)
}
