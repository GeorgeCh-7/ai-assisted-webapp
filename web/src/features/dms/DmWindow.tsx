import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Wifi, WifiOff, Lock } from 'lucide-react'
import { useMe } from '@/features/auth/useAuth'
import MessageList from '@/features/chat/MessageList'
import MessageComposer from '@/features/chat/MessageComposer'
import type { MessageDto, OptimisticMessage } from '@/features/chat/types'
import { useDmMessageHistory, useDmThread, useSendDmMessage } from './useDms'
import { useDmSignalR } from './useDmSignalR'
import { useHeartbeat } from '@/hooks/useHeartbeat'
import type { DmMessageDto, OptimisticDmMessage } from './types'

type ReplyCtx = { messageId: string; username: string; content: string }
type EditCtx = { messageId: string; content: string }

// MessageList expects MessageDto; DmMessageDto is structurally identical minus roomId.
function adaptMsg(m: DmMessageDto): MessageDto {
  return { ...m, roomId: '' }
}
function adaptOptimistic(m: OptimisticDmMessage): OptimisticMessage {
  return { ...m, roomId: '' }
}

export default function DmWindow() {
  const { threadId = '' } = useParams<{ threadId: string }>()
  const { data: me } = useMe()

  const { hub, connected } = useDmSignalR(threadId)
  const { data: thread } = useDmThread(threadId)
  const qc = useQueryClient()

  useHeartbeat(hub)

  // Clear unread badge when thread opens — JoinDm zeroes DB count server-side;
  // invalidate once so sidebar reflects it, decoupled from the SignalR call chain.
  useEffect(() => {
    if (!threadId) return
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['dms'] }), 600)
    return () => clearTimeout(t)
  }, [threadId, qc])

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useDmMessageHistory(threadId)

  const { send, pending } = useSendDmMessage(threadId, me, hub)

  const [replyCtx, setReplyCtx] = useState<ReplyCtx | null>(null)
  const [editCtx, setEditCtx] = useState<EditCtx | null>(null)

  const idempotencyKeyRef = useRef(crypto.randomUUID())

  const isFrozen = !!thread?.frozenAt || !!thread?.otherPartyDeletedAt

  const confirmed: MessageDto[] = (data?.pages.flatMap(p => p.items).reverse() ?? []).map(adaptMsg)
  const confirmedIds = new Set(confirmed.map(m => m.id))
  const pendingFiltered = pending.filter((m: OptimisticDmMessage) => !confirmedIds.has(m.id))
  const displayMessages: (MessageDto | OptimisticMessage)[] = [
    ...confirmed,
    ...pendingFiltered.map(adaptOptimistic),
  ]

  const handleSend = (content: string, idempotencyKey: string, attachmentFileIds: string[]) => {
    send(content, idempotencyKey, replyCtx?.messageId ?? null, attachmentFileIds)
    setReplyCtx(null)
  }

  const handleEditSend = (content: string) => {
    if (!editCtx || !hub) return
    hub.invoke('EditDirectMessage', { messageId: editCtx.messageId, content }).catch(() => {})
    setEditCtx(null)
  }

  const handleDelete = (messageId: string) => {
    if (!hub) return
    hub.invoke('DeleteDirectMessage', { messageId }).catch(() => {})
  }

  // Reset idempotency key on mount
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID()
  }, [threadId])

  const otherUsername = thread?.otherUser.username ?? '…'

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5 bg-muted/20 shrink-0">
        <Link
          to="/friends"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to contacts"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold truncate">{otherUsername}</span>
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors ${
                connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              }`}
              title={connected ? 'Connected' : 'Connecting…'}
            />
          </div>
          {isFrozen && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center gap-1">
              <Lock className="h-2.5 w-2.5" />
              {thread?.otherPartyDeletedAt ? 'Account deleted — history preserved' : 'Conversation frozen'}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {connected ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-muted-foreground/50 animate-pulse" />
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
        meId={me?.id}
        myRole={null}
        onReply={setReplyCtx}
        onEditStart={(msgId, content) => setEditCtx({ messageId: msgId, content })}
        onDelete={isFrozen ? undefined : handleDelete}
      />

      {/* Composer */}
      {isFrozen ? (
        <div className="border-t px-4 py-3 bg-muted/10 shrink-0">
          <p className="text-xs font-mono text-muted-foreground text-center">
            {thread?.otherPartyDeletedAt
              ? 'This user deleted their account. Conversation is read-only.'
              : 'This conversation is frozen. Unblock the user to continue.'}
          </p>
        </div>
      ) : (
        <MessageComposer
          onSend={handleSend}
          onEditSend={handleEditSend}
          editCtx={editCtx}
          onCancelEdit={() => setEditCtx(null)}
          replyCtx={replyCtx}
          onCancelReply={() => setReplyCtx(null)}
          disabled={!connected}
          uploadContext={{ scope: 'dm', scopeId: threadId }}
        />
      )}
    </div>
  )
}
