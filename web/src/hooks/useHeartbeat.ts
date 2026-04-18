import { useEffect } from 'react'
import type { HubLike } from '@/features/chat/useSignalR'

const HEARTBEAT_MS = 15_000
const IDLE_THRESHOLD_MS = HEARTBEAT_MS * 2
const CHANNEL_NAME = 'chat:activity'

export function useHeartbeat(hub: HubLike | null) {
  useEffect(() => {
    if (!hub) return

    let lastInteraction = Date.now()

    // BroadcastChannel fires in OTHER tabs when any tab posts a message.
    // This replaces localStorage+StorageEvent for cross-tab activity coordination.
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = () => { lastInteraction = Date.now() }
    } catch {
      // BroadcastChannel not available (e.g. test environment) — single-tab only
    }

    const markActive = () => {
      lastInteraction = Date.now()
      try { channel?.postMessage(null) } catch {}
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') markActive()
    }

    const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'focus'] as const
    EVENTS.forEach(ev => window.addEventListener(ev, markActive, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibility)

    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInteraction > IDLE_THRESHOLD_MS) return
      hub.invoke('Heartbeat', {}).catch(() => {})
    }, HEARTBEAT_MS)

    return () => {
      clearInterval(timer)
      EVENTS.forEach(ev => window.removeEventListener(ev, markActive))
      document.removeEventListener('visibilitychange', handleVisibility)
      channel?.close()
    }
  }, [hub])
}
