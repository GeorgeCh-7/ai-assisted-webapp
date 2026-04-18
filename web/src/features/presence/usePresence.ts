import { useQuery } from '@tanstack/react-query'

export type PresenceStatus = 'online' | 'afk' | 'offline'

export function usePresence(userId: string) {
  return useQuery<PresenceStatus>({
    queryKey: ['presence', userId],
    queryFn: () => Promise.resolve<PresenceStatus>('offline'),
    staleTime: Infinity,
    enabled: !!userId,
  })
}
