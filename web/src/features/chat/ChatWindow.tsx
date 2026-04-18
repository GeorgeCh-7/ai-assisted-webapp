import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Users, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMe } from '@/features/auth/useAuth'
import { useRoom, useLeaveRoom } from '@/features/rooms/useRooms'
import { useSignalR } from './useSignalR'
import { useMessageHistory, useSendMessage } from './useMessages'
import MessageList from './MessageList'
import MessageComposer from './MessageComposer'
import type { MessageDto, OptimisticMessage } from './types'

export default function ChatWindow() {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const { data: me } = useMe()
  const { data: room } = useRoom(roomId)
  const { mutate: leaveRoom, isPending: leaving } = useLeaveRoom()

  const { hub, connected, currentWatermark: _ } = useSignalR(roomId)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useMessageHistory(roomId)

  const { send, pending } = useSendMessage(roomId, me, hub)

  // Merge TQ cache (pages DESC each) → reversed to ASC, then append optimistic messages.
  // Dedup: remove any pending message already confirmed in the cache.
  const confirmed: MessageDto[] = data?.pages.flatMap(p => p.items).reverse() ?? []
  const confirmedIds = new Set(confirmed.map(m => m.id))
  const pendingFiltered = pending.filter(
    (m: OptimisticMessage) => !confirmedIds.has(m.id),
  )
  const displayMessages = [...confirmed, ...pendingFiltered]

  const handleSend = (content: string, idempotencyKey: string) => {
    send(content, idempotencyKey)
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5 bg-muted/20 shrink-0">
        <Link
          to="/rooms"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to rooms"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-emerald-600 dark:text-emerald-500 font-mono text-sm">#</span>
            <h1 className="font-mono text-sm font-semibold truncate">
              {room?.name ?? roomId}
            </h1>
            {/* Connection status dot */}
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
              title={connected ? 'Connected' : 'Connecting…'}
            />
          </div>
          {room?.description && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {room.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {room && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
              <Users className="h-3 w-3" />
              {room.memberCount}
            </span>
          )}

          {connected ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-muted-foreground/50 animate-pulse" />
          )}

          {room?.myRole !== 'owner' && room?.isMember && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] font-mono px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => leaveRoom(roomId)}
              disabled={leaving}
            >
              leave
            </Button>
          )}
        </div>
      </div>

      {/* Message area */}
      <MessageList
        messages={displayMessages}
        hasNextPage={!!hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        isLoading={isLoading}
      />

      {/* Composer */}
      <MessageComposer onSend={handleSend} disabled={!connected} />
    </div>
  )
}
