import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { useHubContext } from './HubProvider'
import type { PresenceStatus } from '@/features/presence/usePresence'
import { incrementUnread } from '@/hooks/useUnread'

export function useGlobalHubEvents() {
  const { hub } = useHubContext()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!hub) return

    const handleFriendRequestReceived = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
    }
    const handleFriendRequestAccepted = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
      qc.invalidateQueries({ queryKey: ['friends'] })
    }
    const handleFriendRequestDeclined = () => {
      qc.invalidateQueries({ queryKey: ['friend-requests'] })
    }
    const handleFriendRemoved = () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    }
    const handleUserBanned = () => {
      qc.invalidateQueries({ queryKey: ['friends'] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    }
    const handleInvitationReceived = () => {
      qc.invalidateQueries({ queryKey: ['invitations'] })
    }
    const handleRoomBanned = () => {
      qc.invalidateQueries({ queryKey: ['rooms'] })
      navigate('/rooms')
    }
    const handlePresence = (payload: unknown) => {
      const { userId, status } = payload as { userId: string; status: PresenceStatus }
      qc.setQueryData<PresenceStatus>(['presence', userId], status)
    }
    const handleRoomCreated = () => {
      qc.invalidateQueries({ queryKey: ['rooms'] })
    }
    const handleRoomDeletedGlobal = () => {
      qc.invalidateQueries({ queryKey: ['rooms'] })
    }
    const handleDmThreadCreated = () => {
      qc.invalidateQueries({ queryKey: ['dms'] })
    }
    const handleRoomUnreadUpdated = (payload: unknown) => {
      const { roomId } = payload as { roomId: string }
      // Skip increment if user is currently viewing that room (useSignalR handles it there)
      if (!location.pathname.includes(roomId)) {
        incrementUnread(qc, roomId)
      }
    }
    const handleDmUnreadUpdated = (payload: unknown) => {
      const { threadId } = payload as { threadId: string }
      if (location.pathname.includes(threadId)) return
      qc.invalidateQueries({ queryKey: ['dms'] })
    }

    hub.on('FriendRequestReceived', handleFriendRequestReceived)
    hub.on('FriendRequestAccepted', handleFriendRequestAccepted)
    hub.on('FriendRequestDeclined', handleFriendRequestDeclined)
    hub.on('FriendRemoved', handleFriendRemoved)
    hub.on('UserBanned', handleUserBanned)
    hub.on('RoomInvitationReceived', handleInvitationReceived)
    hub.on('RoomBanned', handleRoomBanned)
    hub.on('PresenceChanged', handlePresence)
    hub.on('RoomCreated', handleRoomCreated)
    hub.on('RoomDeleted', handleRoomDeletedGlobal)
    hub.on('DmThreadCreated', handleDmThreadCreated)
    hub.on('RoomUnreadUpdated', handleRoomUnreadUpdated)
    hub.on('DmUnreadUpdated', handleDmUnreadUpdated)

    return () => {
      hub.off('FriendRequestReceived', handleFriendRequestReceived)
      hub.off('FriendRequestAccepted', handleFriendRequestAccepted)
      hub.off('FriendRequestDeclined', handleFriendRequestDeclined)
      hub.off('FriendRemoved', handleFriendRemoved)
      hub.off('UserBanned', handleUserBanned)
      hub.off('RoomInvitationReceived', handleInvitationReceived)
      hub.off('RoomBanned', handleRoomBanned)
      hub.off('PresenceChanged', handlePresence)
      hub.off('RoomCreated', handleRoomCreated)
      hub.off('RoomDeleted', handleRoomDeletedGlobal)
      hub.off('DmThreadCreated', handleDmThreadCreated)
      hub.off('RoomUnreadUpdated', handleRoomUnreadUpdated)
      hub.off('DmUnreadUpdated', handleDmUnreadUpdated)
    }
  }, [hub, qc, navigate, location.pathname])
}
