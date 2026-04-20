import { useEffect } from 'react'
import type { HubLike } from '@/features/chat/useSignalR'

// Single heartbeat on mount so the server marks the user online immediately
// when they open a room or DM. Recurring heartbeats are handled by useAfkTracker.
export function useHeartbeat(hub: HubLike | null) {
  useEffect(() => {
    if (!hub) return
    hub.invoke('Heartbeat').catch(() => {})
  }, [hub])
}
