import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useHubContext } from './HubProvider'
import type { PresenceStatus } from '@/features/presence/usePresence'

export function useGlobalHubEvents() {
  const { hub } = useHubContext()
  const qc = useQueryClient()
  const navigate = useNavigate()

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
    }
  }, [hub, qc, navigate])
}
