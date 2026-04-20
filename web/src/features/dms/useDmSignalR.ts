import { useEffect, useRef } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { prependConfirmedDmMessage } from './useDms'
import { useHubContext } from '@/features/chat/HubProvider'
import type { DmMessageDto, PagedDmMessagesResponse } from './types'

export function useDmSignalR(threadId: string) {
  const { hub, connectionState, subscribeReconnect } = useHubContext()
  const qc = useQueryClient()
  const lastSeenWatermarkRef = useRef(0)

  // Re-join DM group on hub reconnect
  useEffect(() => {
    if (!hub || !threadId) return
    const handleReconnect = async () => {
      await hub.invoke('JoinDm', { threadId })
    }
    return subscribeReconnect(handleReconnect)
  }, [hub, threadId, subscribeReconnect])

  // DM-scoped event handlers + JoinDm/LeaveDm lifecycle
  useEffect(() => {
    if (!hub || !threadId) return

    const handleDirectMessage = (payload: unknown) => {
      const msg = payload as DmMessageDto
      if (msg.dmThreadId !== threadId) return
      lastSeenWatermarkRef.current = Math.max(lastSeenWatermarkRef.current, msg.watermark)
      qc.setQueryData<InfiniteData<PagedDmMessagesResponse>>(
        ['dm-messages', threadId],
        old => prependConfirmedDmMessage(old, msg),
      )
      qc.invalidateQueries({ queryKey: ['dms'] })
    }

    const handleDirectMessageEdited = (payload: unknown) => {
      const msg = payload as DmMessageDto
      qc.setQueryData<InfiniteData<PagedDmMessagesResponse>>(
        ['dm-messages', msg.dmThreadId],
        old => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map(page => ({
              ...page,
              items: page.items.map(m =>
                m.id === msg.id ? { ...m, content: msg.content, editedAt: msg.editedAt } : m,
              ),
            })),
          }
        },
      )
    }

    const handleDirectMessageDeleted = (payload: unknown) => {
      const { id, dmThreadId, deletedAt } = payload as { id: string; dmThreadId: string; deletedAt: string }
      qc.setQueryData<InfiniteData<PagedDmMessagesResponse>>(
        ['dm-messages', dmThreadId],
        old => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map(page => ({
              ...page,
              items: page.items.map(m =>
                m.id === id ? { ...m, content: '', deletedAt } : m,
              ),
            })),
          }
        },
      )
    }

    // Only the DM-thread-specific part of UserBanned — global queries handled by useGlobalHubEvents
    const handleUserBanned = () => {
      qc.invalidateQueries({ queryKey: ['dm', threadId] })
    }

    const handleError = (payload: unknown) => {
      console.warn('[DmHub]', payload)
    }

    hub.on('DirectMessageReceived', handleDirectMessage)
    hub.on('DirectMessageEdited', handleDirectMessageEdited)
    hub.on('DirectMessageDeleted', handleDirectMessageDeleted)
    hub.on('UserBanned', handleUserBanned)
    hub.on('Error', handleError)

    hub.invoke('JoinDm', { threadId })
      .then(() => {
        // Force fresh fetch so messages sent while we were elsewhere aren't hidden by staleTime.
        qc.invalidateQueries({ queryKey: ['dm-messages', threadId] })
      })
      .catch(() => {})

    return () => {
      hub.off('DirectMessageReceived', handleDirectMessage)
      hub.off('DirectMessageEdited', handleDirectMessageEdited)
      hub.off('DirectMessageDeleted', handleDirectMessageDeleted)
      hub.off('UserBanned', handleUserBanned)
      hub.off('Error', handleError)
      hub.invoke('LeaveDm', { threadId }).catch(() => {})
      lastSeenWatermarkRef.current = 0
    }
  }, [hub, threadId, qc])

  return { hub, connected: connectionState === 'connected' }
}
