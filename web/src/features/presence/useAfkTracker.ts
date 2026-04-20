import { useEffect, useRef } from 'react'
import { useHubContext } from '@/features/chat/HubProvider'

const HEARTBEAT_MS = 15_000
const IDLE_THRESHOLD_MS = HEARTBEAT_MS * 2
const CHANNEL_NAME = 'chat:activity'

export function useAfkTracker() {
  const { hub } = useHubContext()
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
      if (!hub) return
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInteractionRef.current > IDLE_THRESHOLD_MS) return
      hub.invoke('Heartbeat', {}).catch(() => {})
    }, HEARTBEAT_MS)

    return () => {
      clearInterval(timer)
      EVENTS.forEach(ev => window.removeEventListener(ev, markActive))
      channel?.close()
    }
  }, [hub])
}
