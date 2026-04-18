import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { prependConfirmedMessage } from './useMessages'
import type { MessageDto, PagedMessagesResponse } from './types'

// Duck-typed interface satisfied by both the mock hub and the real
// @microsoft/signalr HubConnection. Keeps this file importable before
// the npm package is installed (Chunk D wires the real client).
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

async function buildConnection(): Promise<HubLike> {
  if (import.meta.env.VITE_MSW_ENABLED === 'true') {
    const { createMockHubConnection } = await import('@/mocks/signalr')
    return createMockHubConnection() as unknown as HubLike
  }
  // Chunk D: install @microsoft/signalr and replace this branch with:
  // const { HubConnectionBuilder } = await import('@microsoft/signalr')
  // return new HubConnectionBuilder().withUrl('/hubs/chat').withAutomaticReconnect().build()
  throw new Error('Set VITE_MSW_ENABLED=true or run: npm install @microsoft/signalr')
}

type UseSignalROptions = {
  // Called by Chunk D after reconnect so useSendMessage can resubmit in-flight sends.
  // Chunk C leaves this undefined — reconnect wiring arrives in Chunk D.
  onReconnected?: (hub: HubLike) => Promise<void>
}

export function useSignalR(roomId: string, options: UseSignalROptions = {}) {
  const { onReconnected } = options
  const qc = useQueryClient()
  const [hub, setHub] = useState<HubLike | null>(null)
  const [connected, setConnected] = useState(false)
  const [currentWatermark, setCurrentWatermark] = useState(0)
  // Stable ref so the onreconnected closure added in Chunk D can call the latest callback
  const onReconnectedRef = useRef(onReconnected)
  onReconnectedRef.current = onReconnected

  useEffect(() => {
    if (!roomId) return

    let cancelled = false

    // Defined here so each effect invocation gets its own stable handler references,
    // allowing correct cleanup via .off(event, handler)
    const handleMessage = (payload: unknown) => {
      const msg = payload as MessageDto
      qc.setQueryData<InfiniteData<PagedMessagesResponse>>(
        ['messages', roomId],
        old => prependConfirmedMessage(old, msg),
      )
    }

    const handleError = (payload: unknown) => {
      // Hub errors arrive as SignalR "Error" events, NOT as thrown exceptions
      // (see contracts.md — hub methods never throw). Log for visibility.
      console.warn('[ChatHub]', payload)
    }

    buildConnection()
      .then(async conn => {
        if (cancelled) { conn.stop(); return }

        conn.on('MessageReceived', handleMessage)
        conn.on('Error', handleError)

        await conn.start()
        if (cancelled) { conn.stop(); return }

        const result = await conn.invoke<{ currentWatermark: number } | null>(
          'JoinRoom',
          { roomId },
        )

        if (cancelled) return

        if (result) setCurrentWatermark(result.currentWatermark)
        setHub(conn)
        setConnected(true)
      })
      .catch(err => {
        if (!cancelled) console.error('[useSignalR]', err)
      })

    return () => {
      cancelled = true
      setHub(prev => {
        if (prev) {
          prev.off('MessageReceived', handleMessage)
          prev.off('Error', handleError)
          prev.invoke('LeaveRoom', { roomId }).catch(() => {})
          prev.stop()
        }
        return null
      })
      setConnected(false)
    }
  }, [roomId, qc])

  return { hub, connected, currentWatermark }
}
