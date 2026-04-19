import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { UserDto } from '@/features/auth/types'
import type { HubLike } from './useSignalR'
import type { MessageDto, OptimisticMessage, PagedMessagesResponse } from './types'

export function useMessageHistory(roomId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', roomId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' })
      if (pageParam) params.set('before', pageParam)
      return api.get<PagedMessagesResponse>(`/api/rooms/${roomId}/messages?${params}`)
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!roomId,
  })
}

// Prepends a confirmed message to the first (most-recent) page of the infinite cache.
// No-ops if the message is already present (dedup for MessageReceived vs invoke return races).
export function prependConfirmedMessage(
  old: InfiniteData<PagedMessagesResponse> | undefined,
  msg: MessageDto,
): InfiniteData<PagedMessagesResponse> {
  if (!old) {
    return {
      pages: [{ items: [msg], nextCursor: null }],
      pageParams: [undefined],
    }
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

export function useSendMessage(
  roomId: string,
  me: UserDto | undefined,
  hub: HubLike | null,
) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<OptimisticMessage[]>([])
  // Ref keeps resubmit from closing over stale pending array
  const pendingRef = useRef<OptimisticMessage[]>(pending)
  pendingRef.current = pending

  const send = useCallback(
    async (content: string, idempotencyKey: string, replyToMessageId: string | null = null) => {
      if (!hub || hub.state !== 'Connected' || !me) return

      const optimistic: OptimisticMessage = {
        id: idempotencyKey,
        roomId,
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
        .invoke<MessageDto>('SendMessage', { roomId, content, idempotencyKey, replyToMessageId })
        .catch(() => null)

      if (confirmed) {
        setPending(prev => prev.filter(m => m.idempotencyKey !== idempotencyKey))
        qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
          ['messages', roomId],
          old => prependConfirmedMessage(old, confirmed),
        )
      }
    },
    [hub, roomId, me, qc],
  )

  // Called by useSignalR onReconnected in Chunk D to resubmit in-flight sends.
  // Reads pendingRef so it always sees the latest list without re-creating the callback.
  const resubmit = useCallback(
    async (reconnectedHub: HubLike) => {
      for (const msg of pendingRef.current) {
        const confirmed = await reconnectedHub
          .invoke<MessageDto>('SendMessage', {
            roomId,
            content: msg.content,
            idempotencyKey: msg.idempotencyKey,
          })
          .catch(() => null)
        if (confirmed) {
          setPending(prev => prev.filter(m => m.idempotencyKey !== msg.idempotencyKey))
          qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
            ['messages', roomId],
            old => prependConfirmedMessage(old, confirmed),
          )
        }
      }
    },
    [roomId, qc],
  )

  return { send, pending, resubmit }
}
