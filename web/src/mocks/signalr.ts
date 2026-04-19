import { db, getCurrentUser, nextWatermark, type MockMessage } from './db'

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
    // Hub validates DB membership; clients must POST /api/rooms/{id}/join before invoking JoinRoom
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
  const { roomId, content, idempotencyKey } = arg as {
    roomId: string
    content: string
    idempotencyKey: string
  }

  if (new TextEncoder().encode(content).length > 3072) {
    emit('Error', { code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds 3 KB' })
    return null
  }

  const user = getCurrentUser()
  if (!user) return null

  // Dedup path 1: already persisted (e.g. TanStack Query retry after a successful send)
  const existing = db.messages.get(roomId)?.find(m => m.id === idempotencyKey)
  if (existing) return existing

  // Dedup path 2: concurrent duplicate in flight — all callers get the same object.
  // No await in this function, so all Promise.all branches run synchronously in order:
  // first caller sets the guard and falls through to insert; every subsequent caller
  // hits the guard and returns the winner immediately.
  const inFlight = db.pendingSends.get(idempotencyKey)
  if (inFlight) return inFlight

  const watermark = nextWatermark(roomId)
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
    replyToMessageId: null,
    attachments: [],
  }

  db.pendingSends.set(idempotencyKey, msg)
  if (!db.messages.has(roomId)) db.messages.set(roomId, [])
  db.messages.get(roomId)!.push(msg)
  emit('MessageReceived', msg)
  db.pendingSends.delete(idempotencyKey)

  return msg
}

const invokeHandlers: Record<string, (arg: InvokeArg) => unknown> = {
  JoinRoom: handleJoinRoom,
  LeaveRoom: handleLeaveRoom,
  SendMessage: handleSendMessage,
  Heartbeat: () => null, // updates last_heartbeat_at server-side only; no broadcast in Phase 1
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

// Usage from DevTools:
//   window.__mockHub__.emit('PresenceChanged', { userId: '...', status: 'offline' })
//   window.__mockHub__.emit('MessageReceived', { id: '...', roomId: '...', ... })
if (import.meta.env.VITE_MSW_ENABLED === 'true') {
  ;(
    window as Window & {
      __mockHub__?: { emit: typeof emitSignalREvent }
    }
  ).__mockHub__ = { emit: emitSignalREvent }
}
