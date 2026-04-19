import { useEffect, useRef } from 'react'
import type { HubLike } from '@/features/chat/useSignalR'

const HEARTBEAT_MS = 15_000
const IDLE_THRESHOLD_MS = HEARTBEAT_MS * 2
const CHANNEL_NAME = 'chat:activity'

// Global singleton hub ref — updated by ChatWindow/DmWindow via setAfkHub.
// Lets TopNav send heartbeats without creating a second hub connection.
let globalHub: HubLike | null = null

export function setAfkHub(hub: HubLike | null) {
  globalHub = hub
}

export function useAfkTracker() {
  const lastInteractionRef = useRef(Date.now())

  useEffect(() => {
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = () => { lastInteractionRef.current = Date.now() }
    } catch {
      // not available in all environments
    }

    const markActive = () => {
      lastInteractionRef.current = Date.now()
      try { channel?.postMessage(null) } catch {}
    }

    const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'focus'] as const
    EVENTS.forEach(ev => window.addEventListener(ev, markActive, { passive: true }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') markActive()
    })

    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInteractionRef.current > IDLE_THRESHOLD_MS) return
      globalHub?.invoke('Heartbeat', {}).catch(() => {})
    }, HEARTBEAT_MS)

    return () => {
      clearInterval(timer)
      EVENTS.forEach(ev => window.removeEventListener(ev, markActive))
      channel?.close()
    }
  }, [])
}
