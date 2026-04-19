import {
  db,
  getCurrentUser,
  nextWatermark,
  nextDmWatermark,
  getFriendship,
  getUserBan,
  type MockMessage,
  type MockDmMessage,
} from './db'

type EventListener = (...args: unknown[]) => void

// Module-level listener registry — shared across all connections created by this module.
// useSignalR stores the connection in a ref, so only one connection is active at a time.
// React cleanup calls .off() for each handler, keeping this map clean on unmount.
const listeners = new Map<string, Set<EventListener>>()

function emit(event: string, payload: unknown): void {
  listeners.get(event)?.forEach(cb => {
    try {
      cb(payload)
    } catch {
      // Listener errors must not break other listeners or the hub logic
    }
  })
}

// ── Invoke handlers ────────────────────────────────────────────────────────────

type InvokeArg = Record<string, unknown>

function handleJoinRoom(arg: InvokeArg): { currentWatermark: number } | null {
  const roomId = arg.roomId as string
  const user = getCurrentUser()
  if (!user) {
    emit('Error', { code: 'NOT_MEMBER', message: 'Not authenticated' })
    return null
  }
  const members = db.memberships.get(roomId)
  if (!members?.has(user.id)) {
    emit('Error', { code: 'NOT_MEMBER', message: 'Not a member of this room' })
    return null
  }
  const currentWatermark = db.watermarks.get(roomId) ?? 0
  emit('UserJoinedRoom', { userId: user.id, username: user.username, roomId })
  return { currentWatermark }
}

function handleLeaveRoom(arg: InvokeArg): null {
  const roomId = arg.roomId as string
  const user = getCurrentUser()
  if (user) emit('UserLeftRoom', { userId: user.id, roomId })
  return null
}

function handleSendMessage(arg: InvokeArg): MockMessage | null {
  const { roomId, content, idempotencyKey, replyToMessageId = null, attachmentFileIds = [] } = arg as {
    roomId: string
    content: string
    idempotencyKey: string
    replyToMessageId?: string | null
    attachmentFileIds?: string[]
  }

  if (new TextEncoder().encode(content).length > 3072) {
    emit('Error', { code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds 3 KB' })
    return null
  }

  const user = getCurrentUser()
  if (!user) return null

  // Dedup path 1: already persisted
  const existing = db.messages.get(roomId)?.find(m => m.id === idempotencyKey)
  if (existing) return existing

  // Dedup path 2: concurrent duplicate in flight
  const inFlight = db.pendingSends.get(idempotencyKey)
  if (inFlight) return inFlight

  const watermark = nextWatermark(roomId)
  const attachments = (attachmentFileIds as string[]).flatMap(fid => {
    const f = db.fileAttachments.find(a => a.id === fid)
    if (!f) return []
    f.messageId = idempotencyKey
    return [{ id: f.id, originalFilename: f.originalFilename, contentType: f.contentType, sizeBytes: f.sizeBytes }]
  })

  const msg: MockMessage = {
    id: idempotencyKey,
    roomId,
    authorId: user.id,
    authorUsername: user.username,
    content,
    sentAt: new Date().toISOString(),
    idempotencyKey,
    watermark,
    editedAt: null,
    deletedAt: null,
    replyToMessageId: replyToMessageId as string | null,
    attachments,
  }

  db.pendingSends.set(idempotencyKey, msg)
  if (!db.messages.has(roomId)) db.messages.set(roomId, [])
  db.messages.get(roomId)!.push(msg)
  emit('MessageReceived', msg)
  db.pendingSends.delete(idempotencyKey)

  return msg
}

function handleEditMessage(arg: InvokeArg): MockMessage | null {
  const { messageId, content } = arg as { messageId: string; content: string }
  const user = getCurrentUser()
  if (!user) return null

  if (new TextEncoder().encode(content).length > 3072) {
    emit('Error', { code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds 3 KB' })
    return null
  }

  for (const msgs of db.messages.values()) {
    const msg = msgs.find(m => m.id === messageId)
    if (msg) {
      if (msg.authorId !== user.id) {
        emit('Error', { code: 'NOT_AUTHOR', message: 'Only the author can edit' })
        return null
      }
      msg.content = content
      msg.editedAt = new Date().toISOString()
      emit('MessageEdited', { ...msg, attachments: msg.attachments })
      return msg
    }
  }
  emit('Error', { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' })
  return null
}

function handleDeleteMessage(arg: InvokeArg): { id: string; deletedAt: string } | null {
  const { messageId } = arg as { messageId: string }
  const user = getCurrentUser()
  if (!user) return null

  for (const [roomId, msgs] of db.messages) {
    const msg = msgs.find(m => m.id === messageId)
    if (msg) {
      const myRole = db.memberships.get(roomId)?.get(user.id)
      const canDelete = msg.authorId === user.id || myRole === 'owner' || myRole === 'admin'
      if (!canDelete) {
        emit('Error', { code: 'NOT_ADMIN', message: 'Insufficient permission' })
        return null
      }
      msg.deletedAt = new Date().toISOString()
      msg.content = ''
      const result = { id: messageId, roomId, deletedAt: msg.deletedAt }
      emit('MessageDeleted', result)
      return result
    }
  }
  emit('Error', { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' })
  return null
}

function handleJoinDm(arg: InvokeArg): { currentWatermark: number } | null {
  const { threadId } = arg as { threadId: string }
  const user = getCurrentUser()
  if (!user) return null

  const thread = db.dmThreads.find(t => t.id === threadId)
  if (!thread || (thread.userAId !== user.id && thread.userBId !== user.id)) {
    emit('Error', { code: 'DM_THREAD_NOT_FOUND', message: 'Thread not found' })
    return null
  }
  return { currentWatermark: db.dmWatermarks.get(threadId) ?? 0 }
}

function handleLeaveDm(_arg: InvokeArg): null {
  return null
}

function handleSendDirectMessage(arg: InvokeArg): MockDmMessage | null {
  const {
    threadId,
    content,
    idempotencyKey,
    replyToMessageId = null,
    attachmentFileIds = [],
  } = arg as {
    threadId: string
    content: string
    idempotencyKey: string
    replyToMessageId?: string | null
    attachmentFileIds?: string[]
  }

  const user = getCurrentUser()
  if (!user) return null

  const thread = db.dmThreads.find(t => t.id === threadId)
  if (!thread || (thread.userAId !== user.id && thread.userBId !== user.id)) {
    emit('Error', { code: 'DM_THREAD_NOT_FOUND', message: 'Thread not found' })
    return null
  }
  if (thread.frozenAt || thread.otherPartyDeletedAt) {
    emit('Error', { code: 'THREAD_FROZEN', message: 'Thread is frozen' })
    return null
  }

  const otherId = thread.userAId === user.id ? thread.userBId : thread.userAId
  const friendship = getFriendship(user.id, otherId)
  if (!friendship || friendship.status !== 'accepted') {
    emit('Error', { code: 'NOT_FRIENDS', message: 'Not friends' })
    return null
  }
  if (getUserBan(user.id, otherId) || getUserBan(otherId, user.id)) {
    emit('Error', { code: 'USER_BANNED', message: 'User banned' })
    return null
  }

  if (new TextEncoder().encode(content).length > 3072) {
    emit('Error', { code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds 3 KB' })
    return null
  }

  const existing = db.dmMessages.get(threadId)?.find(m => m.id === idempotencyKey)
  if (existing) return existing

  const watermark = nextDmWatermark(threadId)
  const attachments = (attachmentFileIds as string[]).flatMap(fid => {
    const f = db.fileAttachments.find(a => a.id === fid)
    if (!f) return []
    f.dmMessageId = idempotencyKey
    return [{ id: f.id, originalFilename: f.originalFilename, contentType: f.contentType, sizeBytes: f.sizeBytes }]
  })

  const msg: MockDmMessage = {
    id: idempotencyKey,
    dmThreadId: threadId,
    authorId: user.id,
    authorUsername: user.username,
    content,
    sentAt: new Date().toISOString(),
    idempotencyKey,
    watermark,
    editedAt: null,
    deletedAt: null,
    replyToMessageId: replyToMessageId as string | null,
    attachments,
  }

  if (!db.dmMessages.has(threadId)) db.dmMessages.set(threadId, [])
  db.dmMessages.get(threadId)!.push(msg)
  emit('DirectMessageReceived', msg)

  // Increment unread for the other party
  if (!db.dmUnreads.has(otherId)) db.dmUnreads.set(otherId, new Map())
  const otherUnreads = db.dmUnreads.get(otherId)!
  otherUnreads.set(threadId, (otherUnreads.get(threadId) ?? 0) + 1)

  return msg
}

function handleEditDirectMessage(arg: InvokeArg): MockDmMessage | null {
  const { messageId, content } = arg as { messageId: string; content: string }
  const user = getCurrentUser()
  if (!user) return null

  if (new TextEncoder().encode(content).length > 3072) {
    emit('Error', { code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds 3 KB' })
    return null
  }

  for (const msgs of db.dmMessages.values()) {
    const msg = msgs.find(m => m.id === messageId)
    if (msg) {
      if (msg.authorId !== user.id) {
        emit('Error', { code: 'NOT_AUTHOR', message: 'Only the author can edit' })
        return null
      }
      msg.content = content
      msg.editedAt = new Date().toISOString()
      emit('DirectMessageEdited', msg)
      return msg
    }
  }
  emit('Error', { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' })
  return null
}

function handleDeleteDirectMessage(arg: InvokeArg): { id: string; dmThreadId: string; deletedAt: string } | null {
  const { messageId } = arg as { messageId: string }
  const user = getCurrentUser()
  if (!user) return null

  for (const [threadId, msgs] of db.dmMessages) {
    const msg = msgs.find(m => m.id === messageId)
    if (msg) {
      if (msg.authorId !== user.id) {
        emit('Error', { code: 'NOT_AUTHOR', message: 'Only the author can delete in DMs' })
        return null
      }
      msg.deletedAt = new Date().toISOString()
      msg.content = ''
      const result = { id: messageId, dmThreadId: threadId, deletedAt: msg.deletedAt }
      emit('DirectMessageDeleted', result)
      return result
    }
  }
  emit('Error', { code: 'MESSAGE_NOT_FOUND', message: 'Message not found' })
  return null
}

const invokeHandlers: Record<string, (arg: InvokeArg) => unknown> = {
  JoinRoom: handleJoinRoom,
  LeaveRoom: handleLeaveRoom,
  SendMessage: handleSendMessage,
  EditMessage: handleEditMessage,
  DeleteMessage: handleDeleteMessage,
  JoinDm: handleJoinDm,
  LeaveDm: handleLeaveDm,
  SendDirectMessage: handleSendDirectMessage,
  EditDirectMessage: handleEditDirectMessage,
  DeleteDirectMessage: handleDeleteDirectMessage,
  Heartbeat: () => null,
}

// ── Mock HubConnection ─────────────────────────────────────────────────────────

export type MockHubConnectionState =
  | 'Connected'
  | 'Disconnected'
  | 'Connecting'
  | 'Disconnecting'
  | 'Reconnecting'

export function createMockHubConnection() {
  let state: MockHubConnectionState = 'Disconnected'

  const reconnectingCbs = new Set<(error?: Error) => void>()
  const reconnectedCbs = new Set<(connectionId?: string) => void>()
  const closeCbs = new Set<(error?: Error) => void>()

  return {
    get state(): MockHubConnectionState {
      return state
    },

    start(): Promise<void> {
      state = 'Connected'
      const user = getCurrentUser()
      if (user) {
        db.presence.set(user.id, 'online')
        // Defer one microtask so any .on() calls made synchronously after start() are registered
        // before the PresenceChanged event fires
        Promise.resolve().then(() => {
          emit('PresenceChanged', { userId: user.id, status: 'online' })
        })
      }
      return Promise.resolve()
    },

    stop(): Promise<void> {
      state = 'Disconnected'
      const user = getCurrentUser()
      if (user) {
        db.presence.set(user.id, 'offline')
        emit('PresenceChanged', { userId: user.id, status: 'offline' })
      }
      closeCbs.forEach(cb => cb())
      return Promise.resolve()
    },

    on(event: string, cb: EventListener): void {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(cb)
    },

    off(event: string, cb?: EventListener): void {
      if (!cb) {
        listeners.delete(event)
        return
      }
      listeners.get(event)?.delete(cb)
    },

    invoke<T>(methodName: string, arg?: InvokeArg): Promise<T> {
      const handler = invokeHandlers[methodName]
      const result = handler ? handler(arg ?? {}) : null
      return Promise.resolve(result as T)
    },

    onreconnecting(cb: (error?: Error) => void): void {
      reconnectingCbs.add(cb)
    },

    onreconnected(cb: (connectionId?: string) => void): void {
      reconnectedCbs.add(cb)
    },

    onclose(cb: (error?: Error) => void): void {
      closeCbs.add(cb)
    },
  }
}

// ── Dev helpers ────────────────────────────────────────────────────────────────

export function emitSignalREvent(event: string, payload: unknown): void {
  emit(event, payload)
}

// Simulate a RoomInvitationReceived for the current user (call from DevTools)
export function mockInviteCurrentUser(roomId: string, roomName: string, invitedByUsername: string): void {
  emit('RoomInvitationReceived', {
    invitationId: crypto.randomUUID(),
    roomId,
    roomName,
    invitedByUsername,
    createdAt: new Date().toISOString(),
  })
}

// Simulate a FriendRequestReceived for the current user
export function mockFriendRequest(fromUserId: string, fromUsername: string, message: string | null = null): void {
  emit('FriendRequestReceived', { fromUserId, fromUsername, message, requestedAt: new Date().toISOString() })
}

if (import.meta.env.VITE_MSW_ENABLED === 'true') {
  ;(
    window as Window & {
      __mockHub__?: {
        emit: typeof emitSignalREvent
        invite: typeof mockInviteCurrentUser
        friendRequest: typeof mockFriendRequest
      }
    }
  ).__mockHub__ = {
    emit: emitSignalREvent,
    invite: mockInviteCurrentUser,
    friendRequest: mockFriendRequest,
  }
}
