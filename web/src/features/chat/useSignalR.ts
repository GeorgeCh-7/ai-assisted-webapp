import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { prependConfirmedMessage } from './useMessages'
import { incrementUnread } from '@/hooks/useUnread'
import type { MessageDto, PagedMessagesResponse } from './types'
import type { PresenceStatus } from '@/features/presence/usePresence'

export type HubLike = {
  readonly state: string
  start(): Promise<void>
  stop(): Promise<void>
  on(event: string, cb: (...args: unknown[]) => void): void
  off(event: string, cb?: (...args: unknown[]) => void): void
  invoke<T>(method: string, arg?: Record<string, unknown>): Promise<T>
  onreconnecting(cb: (error?: Error) => void): void
  onreconnected(cb: (connectionId?: string) => void): void
  onclose(cb: (error?: Error) => void): void
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

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

type UseSignalROptions = {
  onReconnected?: (hub: HubLike) => Promise<void>
}

export function useSignalR(roomId: string, options: UseSignalROptions = {}) {
  const { onReconnected } = options
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [hub, setHub] = useState<HubLike | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')

  const onReconnectedRef = useRef(onReconnected)
  onReconnectedRef.current = onReconnected

  const lastSeenWatermarkRef = useRef(0)

  useEffect(() => {
    if (!roomId) return

    let cancelled = false
    let connRef: HubLike | null = null

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

    const handlePresence = (payload: unknown) => {
      const { userId, status } = payload as { userId: string; status: PresenceStatus }
      qc.setQueryData<PresenceStatus>(['presence', userId], status)
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

    const handleRoomBanned = (_payload: unknown) => {
      // user-{userId} personal event — we're banned from this room
      qc.invalidateQueries({ queryKey: ['rooms'] })
      navigate('/rooms')
    }

    const handleInvitationReceived = (_payload: unknown) => {
      qc.invalidateQueries({ queryKey: ['invitations'] })
    }

    const handleFriendRequestReceived = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
    }

    const handleFriendRequestAccepted = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
      qc.invalidateQueries({ queryKey: ['friends'] })
    }

    const handleFriendRemoved = () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
    }

    const handleUserBanned = () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    }

    const handleUserJoined = (_payload: unknown) => {
      // UserJoinedRoom fires when someone opens the room window (SignalR group join),
      // not when they become a member — don't touch memberCount here.
    }

    const handleUserLeft = (_payload: unknown) => {
      // Same as above — window close, not membership change.
    }

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

    setConnectionState('connecting')

    buildConnection()
      .then(async conn => {
        if (cancelled) { conn.stop(); return }
        connRef = conn

        conn.on('MessageReceived', handleMessage)
        conn.on('MessageEdited', handleMessageEdited)
        conn.on('MessageDeleted', handleMessageDeleted)
        conn.on('PresenceChanged', handlePresence)
        conn.on('Error', handleError)
        conn.on('UserJoinedRoom', handleUserJoined)
        conn.on('UserLeftRoom', handleUserLeft)
        conn.on('RoleChanged', handleRoleChanged)
        conn.on('RoomDeleted', handleRoomDeleted)
        conn.on('RoomBanned', handleRoomBanned)
        conn.on('RoomInvitationReceived', handleInvitationReceived)
        conn.on('FriendRequestReceived', handleFriendRequestReceived)
        conn.on('FriendRequestAccepted', handleFriendRequestAccepted)
        conn.on('FriendRemoved', handleFriendRemoved)
        conn.on('UserBanned', handleUserBanned)

        conn.onreconnecting(() => {
          if (!cancelled) setConnectionState('reconnecting')
        })

        conn.onreconnected(async () => {
          if (cancelled) return
          try {
            await doGapRecovery(conn)
            await onReconnectedRef.current?.(conn)
          } finally {
            if (!cancelled) setConnectionState('connected')
          }
        })

        conn.onclose(() => {
          if (!cancelled) {
            setHub(null)
            setConnectionState('disconnected')
          }
        })

        await conn.start()
        if (cancelled) { conn.stop(); return }

        await conn.invoke<{ currentWatermark: number } | null>('JoinRoom', { roomId })
        if (cancelled) return

        setHub(conn)
        setConnectionState('connected')
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[useSignalR]', err)
          setConnectionState('disconnected')
        }
      })

    return () => {
      cancelled = true
      const conn = connRef
      if (conn) {
        conn.off('MessageReceived', handleMessage)
        conn.off('MessageEdited', handleMessageEdited)
        conn.off('MessageDeleted', handleMessageDeleted)
        conn.off('PresenceChanged', handlePresence)
        conn.off('Error', handleError)
        conn.off('UserJoinedRoom', handleUserJoined)
        conn.off('UserLeftRoom', handleUserLeft)
        conn.off('RoleChanged', handleRoleChanged)
        conn.off('RoomDeleted', handleRoomDeleted)
        conn.off('RoomBanned', handleRoomBanned)
        conn.off('RoomInvitationReceived', handleInvitationReceived)
        conn.off('FriendRequestReceived', handleFriendRequestReceived)
        conn.off('FriendRequestAccepted', handleFriendRequestAccepted)
        conn.off('FriendRemoved', handleFriendRemoved)
        conn.off('UserBanned', handleUserBanned)
        conn.invoke('LeaveRoom', { roomId }).catch(() => {})
        conn.stop()
      }
      setHub(null)
      setConnectionState('disconnected')
      lastSeenWatermarkRef.current = 0
    }
  }, [roomId, qc, navigate])

  return { hub, connected: connectionState === 'connected', connectionState }
}
