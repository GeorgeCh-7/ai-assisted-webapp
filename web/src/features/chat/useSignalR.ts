import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { prependConfirmedMessage } from './useMessages'
import { incrementUnread } from '@/hooks/useUnread'
import type { MessageDto, PagedMessagesResponse } from './types'
import type { PresenceStatus } from '@/features/presence/usePresence'

// Duck-typed interface satisfied by both the mock hub and the real
// @microsoft/signalr HubConnection. Keeps this file importable before
// the npm package is installed.
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
  // Stable callback; called after gap recovery completes so useSendMessage can
  // resubmit any in-flight sends that were pending at disconnect.
  onReconnected?: (hub: HubLike) => Promise<void>
}

export function useSignalR(roomId: string, options: UseSignalROptions = {}) {
  const { onReconnected } = options
  const qc = useQueryClient()
  const [hub, setHub] = useState<HubLike | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')

  // Always-current callback ref — the onreconnected closure captures this
  // so callers can pass a new function each render without re-running the effect.
  const onReconnectedRef = useRef(onReconnected)
  onReconnectedRef.current = onReconnected

  // Highest watermark seen from live MessageReceived events.
  // Survives reconnects (same effect run). Reset on roomId change / unmount.
  // A value of 0 means no messages received yet — skip gap recovery in that case.
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
      // Count as unread when the tab isn't visible (user is away from this room).
      if (document.visibilityState !== 'visible') {
        incrementUnread(qc, roomId)
      }
    }

    const handlePresence = (payload: unknown) => {
      const { userId, status } = payload as { userId: string; status: PresenceStatus }
      qc.setQueryData<PresenceStatus>(['presence', userId], status)
    }

    const handleError = (payload: unknown) => {
      console.warn('[ChatHub]', payload)
    }

    // Fetches messages with watermark > lastSeen and merges into TQ cache.
    // Only runs when lastSeenWatermark > 0 (had a prior session in this room)
    // and the server's current watermark is ahead.
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
        conn.on('PresenceChanged', handlePresence)
        conn.on('Error', handleError)

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

        // Initial join — gap recovery only fires on onreconnected, not here.
        // First-time join just subscribes to the room group.
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
        conn.off('PresenceChanged', handlePresence)
        conn.off('Error', handleError)
        conn.invoke('LeaveRoom', { roomId }).catch(() => {})
        conn.stop()
      }
      setHub(null)
      setConnectionState('disconnected')
      lastSeenWatermarkRef.current = 0
    }
  }, [roomId, qc])

  return { hub, connected: connectionState === 'connected', connectionState }
}
