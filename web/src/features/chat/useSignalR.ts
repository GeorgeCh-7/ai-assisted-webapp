import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { prependConfirmedMessage } from './useMessages'
import { incrementUnread } from '@/hooks/useUnread'
import { useHubContext } from './HubProvider'
import type { HubLike } from '@/lib/hub'
import type { MessageDto, PagedMessagesResponse } from './types'

export type { HubLike, ConnectionState } from '@/lib/hub'

type UseSignalROptions = {
  onReconnected?: (hub: HubLike) => Promise<void>
}

export function useSignalR(roomId: string, options: UseSignalROptions = {}) {
  const { onReconnected } = options
  const { hub, connectionState, subscribeReconnect } = useHubContext()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const onReconnectedRef = useRef(onReconnected)
  onReconnectedRef.current = onReconnected

  const lastSeenWatermarkRef = useRef(0)

  async function doGapRecovery(conn: HubLike): Promise<void> {
    const joinResult = await conn.invoke<{ currentWatermark: number } | null>(
      'JoinRoom',
      { roomId },
    )
    if (!joinResult) return

    const since = lastSeenWatermarkRef.current
    if (since === 0 || joinResult.currentWatermark <= since) return

    let cursor = since
    for (;;) {
      const page = await api.get<PagedMessagesResponse>(
        `/api/rooms/${roomId}/messages?since=${cursor}&limit=50`,
      )
      for (const msg of page.items) {
        lastSeenWatermarkRef.current = Math.max(lastSeenWatermarkRef.current, msg.watermark)
        qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
          ['messages', roomId],
          old => prependConfirmedMessage(old, msg),
        )
      }
      if (!page.nextCursor || page.items.length === 0) break
      cursor = parseInt(page.nextCursor)
    }
  }

  // Register reconnect handler — re-joins room group and recovers gaps on hub reconnect
  useEffect(() => {
    if (!hub || !roomId) return

    const handleReconnect = async () => {
      await doGapRecovery(hub)
      await onReconnectedRef.current?.(hub)
    }

    return subscribeReconnect(handleReconnect)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, roomId, subscribeReconnect])

  // Room-scoped event handlers + JoinRoom/LeaveRoom lifecycle
  useEffect(() => {
    if (!hub || !roomId) return

    const handleMessage = (payload: unknown) => {
      const msg = payload as MessageDto
      lastSeenWatermarkRef.current = Math.max(lastSeenWatermarkRef.current, msg.watermark)
      qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
        ['messages', roomId],
        old => prependConfirmedMessage(old, msg),
      )
      if (document.visibilityState !== 'visible') {
        incrementUnread(qc, roomId)
      }
    }

    const handleMessageEdited = (payload: unknown) => {
      const msg = payload as MessageDto
      qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
        ['messages', roomId],
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

    const handleMessageDeleted = (payload: unknown) => {
      const { id, deletedAt } = payload as { id: string; roomId: string; deletedAt: string }
      qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
        ['messages', roomId],
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

    const handleError = (payload: unknown) => {
      console.warn('[ChatHub]', payload)
    }

    const handleRoleChanged = (payload: unknown) => {
      const { userId, role } = payload as { userId: string; roomId: string; role: string }
      qc.setQueryData<InfiniteData<{ items: { userId: string; role: string }[]; nextCursor: string | null }>>(
        ['room-members', roomId],
        old => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map(page => ({
              ...page,
              items: page.items.map(m => m.userId === userId ? { ...m, role } : m),
            })),
          }
        },
      )
    }

    const handleRoomDeleted = (payload: unknown) => {
      const { roomId: deletedRoomId } = payload as { roomId: string }
      if (deletedRoomId === roomId) {
        qc.invalidateQueries({ queryKey: ['rooms'] })
        navigate('/rooms')
      }
    }

    const handleUserJoined = (_payload: unknown) => {
      // UserJoinedRoom fires on SignalR group join (window open), not membership change.
    }

    const handleUserLeft = (_payload: unknown) => {
      // Same — window close, not membership change.
    }

    hub.on('MessageReceived', handleMessage)
    hub.on('MessageEdited', handleMessageEdited)
    hub.on('MessageDeleted', handleMessageDeleted)
    hub.on('Error', handleError)
    hub.on('UserJoinedRoom', handleUserJoined)
    hub.on('UserLeftRoom', handleUserLeft)
    hub.on('RoleChanged', handleRoleChanged)
    hub.on('RoomDeleted', handleRoomDeleted)

    hub.invoke<{ currentWatermark: number } | null>('JoinRoom', { roomId })
      .then(result => {
        if (result) lastSeenWatermarkRef.current = Math.max(lastSeenWatermarkRef.current, 0)
      })
      .catch(() => {})

    return () => {
      hub.off('MessageReceived', handleMessage)
      hub.off('MessageEdited', handleMessageEdited)
      hub.off('MessageDeleted', handleMessageDeleted)
      hub.off('Error', handleError)
      hub.off('UserJoinedRoom', handleUserJoined)
      hub.off('UserLeftRoom', handleUserLeft)
      hub.off('RoleChanged', handleRoleChanged)
      hub.off('RoomDeleted', handleRoomDeleted)
      hub.invoke('LeaveRoom', { roomId }).catch(() => {})
      lastSeenWatermarkRef.current = 0
    }
  }, [hub, roomId, qc, navigate])

  return { hub, connected: connectionState === 'connected', connectionState }
}
