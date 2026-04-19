import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { prependConfirmedDmMessage } from './useDms'
import type { DmMessageDto, PagedDmMessagesResponse } from './types'
import type { HubLike } from '@/features/chat/useSignalR'

async function buildConnection(): Promise<HubLike> {
  if (import.meta.env.VITE_MSW_ENABLED === 'true') {
    const { createMockHubConnection } = await import('@/mocks/signalr')
    return createMockHubConnection() as unknown as HubLike
  }
  const apiUrl = import.meta.env.VITE_API_URL ?? ''
  const { HubConnectionBuilder } = await import('@microsoft/signalr')
  return new HubConnectionBuilder()
    .withUrl(`${apiUrl}/hubs/chat`, { withCredentials: true })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .build() as unknown as HubLike
}

export function useDmSignalR(threadId: string) {
  const qc = useQueryClient()
  const [hub, setHub] = useState<HubLike | null>(null)
  const [connected, setConnected] = useState(false)
  const lastSeenWatermarkRef = useRef(0)

  useEffect(() => {
    if (!threadId) return

    let cancelled = false
    let connRef: HubLike | null = null

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

    const handleFriendRequestReceived = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
    }

    const handleFriendRequestAccepted = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
      qc.invalidateQueries({ queryKey: ['friends'] })
    }

    const handleFriendRequestDeclined = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
    }

    const handleFriendRemoved = () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    }

    const handleUserBanned = () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
      qc.invalidateQueries({ queryKey: ['dm', threadId] })
    }

    const handleError = (payload: unknown) => {
      console.warn('[DmHub]', payload)
    }

    buildConnection()
      .then(async conn => {
        if (cancelled) { conn.stop(); return }
        connRef = conn

        conn.on('DirectMessageReceived', handleDirectMessage)
        conn.on('DirectMessageEdited', handleDirectMessageEdited)
        conn.on('DirectMessageDeleted', handleDirectMessageDeleted)
        conn.on('FriendRequestReceived', handleFriendRequestReceived)
        conn.on('FriendRequestAccepted', handleFriendRequestAccepted)
        conn.on('FriendRequestDeclined', handleFriendRequestDeclined)
        conn.on('FriendRemoved', handleFriendRemoved)
        conn.on('UserBanned', handleUserBanned)
        conn.on('Error', handleError)

        conn.onclose(() => {
          if (!cancelled) {
            setHub(null)
            setConnected(false)
          }
        })

        await conn.start()
        if (cancelled) { conn.stop(); return }

        await conn.invoke('JoinDm', { threadId })
        if (cancelled) return

        setHub(conn)
        setConnected(true)
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[useDmSignalR]', err)
        }
      })

    return () => {
      cancelled = true
      const conn = connRef
      if (conn) {
        conn.off('DirectMessageReceived', handleDirectMessage)
        conn.off('DirectMessageEdited', handleDirectMessageEdited)
        conn.off('DirectMessageDeleted', handleDirectMessageDeleted)
        conn.off('FriendRequestReceived', handleFriendRequestReceived)
        conn.off('FriendRequestAccepted', handleFriendRequestAccepted)
        conn.off('FriendRequestDeclined', handleFriendRequestDeclined)
        conn.off('FriendRemoved', handleFriendRemoved)
        conn.off('UserBanned', handleUserBanned)
        conn.off('Error', handleError)
        conn.invoke('LeaveDm', { threadId }).catch(() => {})
        conn.stop()
      }
      setHub(null)
      setConnected(false)
      lastSeenWatermarkRef.current = 0
    }
  }, [threadId, qc])

  return { hub, connected }
}
