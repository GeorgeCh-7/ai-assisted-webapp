import { useEffect } from 'react'
import type { HubLike } from '@/features/chat/useSignalR'

const HEARTBEAT_MS = 15_000
// Stop heartbeating after this much inactivity — server AFK sweeper (Phase 2)
// fires 60s after last heartbeat; 30s gives a clean handoff.
const IDLE_THRESHOLD_MS = HEARTBEAT_MS * 2
// localStorage key shared across tabs for cross-tab activity coordination.
// Any tab writing here prevents other tabs from going AFK-silent prematurely.
const ACTIVITY_KEY = 'chat:lastInteraction'

export function useHeartbeat(hub: HubLike | null) {
  useEffect(() => {
    if (!hub) return

    // Treat mount as activity (user navigated to the page).
    // Also seed from localStorage so a tab that just opened inherits activity
    // recorded by a sibling tab.
    let lastInteraction = Date.now()
    try {
      const stored = parseInt(localStorage.getItem(ACTIVITY_KEY) ?? '')
      if (!isNaN(stored)) lastInteraction = Math.max(lastInteraction, stored)
    } catch {}

    const markActive = () => {
      lastInteraction = Date.now()
      try { localStorage.setItem(ACTIVITY_KEY, String(lastInteraction)) } catch {}
    }

    // storage events fire in OTHER tabs when any tab calls localStorage.setItem.
    // This is the cross-tab coordination: if tab B is idle but tab A is active,
    // tab B updates its lastInteraction and continues sending heartbeats.
    const handleStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_KEY && e.newValue) {
        const ts = parseInt(e.newValue)
        if (!isNaN(ts)) lastInteraction = Math.max(lastInteraction, ts)
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') markActive()
    }

    const EVENTS = ['mousemove', 'keydown', 'pointerdown', 'focus'] as const
    EVENTS.forEach(ev => window.addEventListener(ev, markActive, { passive: true }))
    window.addEventListener('storage', handleStorage)
    document.addEventListener('visibilitychange', handleVisibility)

    const timer = setInterval(() => {
      // Don't heartbeat from background tabs.
      if (document.visibilityState !== 'visible') return
      // Don't heartbeat if no user activity anywhere (cross-tab) within the window.
      if (Date.now() - lastInteraction > IDLE_THRESHOLD_MS) return
      hub.invoke('Heartbeat', {}).catch(() => {})
    }, HEARTBEAT_MS)

    return () => {
      clearInterval(timer)
      EVENTS.forEach(ev => window.removeEventListener(ev, markActive))
      window.removeEventListener('storage', handleStorage)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [hub])
}
