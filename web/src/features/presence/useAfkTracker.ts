import { useEffect, useRef } from 'react'
import { useHubContext } from '@/features/chat/HubProvider'

const HEARTBEAT_MS = 15_000
// Stop heartbeats only after 5 min of zero interaction (server AFK threshold is 60 s of missed heartbeats)
const IDLE_THRESHOLD_MS = 5 * 60 * 1000
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

    // Test hooks (DEV only):
    //   __freezeIdle()    → stops heartbeats immediately (simulates 5-min idle)
    //   __markActive()    → resets idle clock (simulates user interaction)
    //   __sendHeartbeat() → fires a heartbeat immediately (bypasses 15 s interval wait)
    if (import.meta.env.DEV) {
      ;(window as Record<string, unknown>)['__freezeIdle'] = () => { lastInteractionRef.current = 0 }
      ;(window as Record<string, unknown>)['__markActive'] = markActive
      // Returns a Promise so tests can await and detect silent invoke failures
      ;(window as Record<string, unknown>)['__sendHeartbeat'] = () => {
        if (!hub) return Promise.reject(new Error('hub is null'))
        return hub.invoke('Heartbeat')
      }
      ;(window as Record<string, unknown>)['__hubState'] = () => hub?.state ?? 'null'
    }

    // Covers typing, clicking, scrolling (reading), touch, tab focus, and navigation
    const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'input', 'focus', 'touchstart', 'popstate'] as const
    EVENTS.forEach(ev => window.addEventListener(ev, markActive, { passive: true }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') markActive()
    })

    const timer = setInterval(() => {
      if (!hub) return
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInteractionRef.current > IDLE_THRESHOLD_MS) return
      hub.invoke('Heartbeat').catch(() => {})
    }, HEARTBEAT_MS)

    return () => {
      clearInterval(timer)
      EVENTS.forEach(ev => window.removeEventListener(ev, markActive))
      channel?.close()
    }
  }, [hub])
}
