import { useCallback, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { UserDto } from '@/features/auth/types'
import type { HubLike } from '@/features/chat/useSignalR'
import type {
  DmMessageDto,
  DmThreadDto,
  OptimisticDmMessage,
  PagedDmMessagesResponse,
  PagedDmThreadsResponse,
} from './types'

export function useDmList() {
  return useQuery({
    queryKey: ['dms'],
    queryFn: () => api.get<PagedDmThreadsResponse>('/api/dms'),
  })
}

export function useDmThread(threadId: string) {
  return useQuery({
    queryKey: ['dm', threadId],
    queryFn: () => api.get<DmThreadDto>(`/api/dms/${threadId}`),
    enabled: !!threadId,
  })
}

export function useOpenDmThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.post<DmThreadDto>('/api/dms/open', { userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dms'] }),
  })
}

export function useDmMessageHistory(threadId: string) {
  return useInfiniteQuery({
    queryKey: ['dm-messages', threadId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' })
      if (pageParam) params.set('before', pageParam)
      return api.get<PagedDmMessagesResponse>(`/api/dms/${threadId}/messages?${params}`)
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!threadId,
  })
}

export function prependConfirmedDmMessage(
  old: InfiniteData<PagedDmMessagesResponse> | undefined,
  msg: DmMessageDto,
): InfiniteData<PagedDmMessagesResponse> {
  if (!old) {
    return { pages: [{ items: [msg], nextCursor: null }], pageParams: [undefined] }
  }
  const allIds = new Set(old.pages.flatMap(p => p.items.map(m => m.id)))
  if (allIds.has(msg.id)) return old
  return {
    ...old,
    pages: [
      { ...old.pages[0], items: [msg, ...old.pages[0].items] },
      ...old.pages.slice(1),
    ],
  }
}

export function useSendDmMessage(
  threadId: string,
  me: UserDto | undefined,
  hub: HubLike | null,
) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<OptimisticDmMessage[]>([])
  const pendingRef = useRef<OptimisticDmMessage[]>(pending)
  pendingRef.current = pending

  const send = useCallback(
    async (
      content: string,
      idempotencyKey: string,
      replyToMessageId: string | null = null,
      attachmentFileIds: string[] = [],
    ) => {
      if (!hub || hub.state !== 'Connected' || !me) return

      const optimistic: OptimisticDmMessage = {
        id: idempotencyKey,
        dmThreadId: threadId,
        authorId: me.id,
        authorUsername: me.username,
        content,
        sentAt: new Date().toISOString(),
        idempotencyKey,
        watermark: 0,
        editedAt: null,
        deletedAt: null,
        replyToMessageId,
        attachments: [],
        pending: true,
      }

      setPending(prev => [...prev, optimistic])

      const confirmed = await hub
        .invoke<DmMessageDto>('SendDirectMessage', { threadId, content, idempotencyKey, replyToMessageId, attachmentFileIds })
        .catch(() => null)

      if (confirmed) {
        setPending(prev => prev.filter(m => m.idempotencyKey !== idempotencyKey))
        qc.setQueryData<InfiniteData<PagedDmMessagesResponse>>(
          ['dm-messages', threadId],
          old => prependConfirmedDmMessage(old, confirmed),
        )
        qc.invalidateQueries({ queryKey: ['dms'] })
      }
    },
    [hub, threadId, me, qc],
  )

  return { send, pending }
}
