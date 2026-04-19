import { useEffect, useLayoutEffect, useRef } from 'react'
import { Reply } from 'lucide-react'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import MessageEditMenu from './MessageEditMenu'
import type { MessageDto, OptimisticMessage } from './types'
import type { RoomRole } from '@/features/rooms/types'

type ReplyContext = {
  messageId: string
  username: string
  content: string
}

type Props = {
  messages: (MessageDto | OptimisticMessage)[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  isLoading: boolean
  meId?: string
  myRole?: RoomRole | null
  onReply?: (ctx: ReplyContext) => void
  onEditStart?: (messageId: string, currentContent: string) => void
  onDelete?: (messageId: string) => void
}

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-lime-600',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-cyan-600',
  'bg-sky-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-pink-500',
] as const

function avatarColor(username: string): string {
  let h = 0
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function MessageList({
  messages,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isLoading,
  meId,
  myRole,
  onReply,
  onEditStart,
  onDelete,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef(0)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    if (isLoading || messages.length === 0 || !isInitialLoad.current) return
    isInitialLoad.current = false
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [isLoading, messages.length])

  const prevLastId = useRef<string | null>(null)
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.id === prevLastId.current) return
    prevLastId.current = last.id

    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || isFetchingNextPage) return
    const delta = el.scrollHeight - prevScrollHeightRef.current
    if (delta > 0 && prevScrollHeightRef.current > 0) {
      el.scrollTop += delta
    }
    prevScrollHeightRef.current = el.scrollHeight
  })

  const handleFetchMore = () => {
    const el = containerRef.current
    if (el) prevScrollHeightRef.current = el.scrollHeight
    fetchNextPage()
  }

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          handleFetchMore()
        }
      },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNextPage, isFetchingNextPage])

  // Build a lookup for reply-to message content (for quote block rendering)
  const messageIndex = new Map(messages.map(m => [m.id, m]))

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto min-h-0 flex flex-col"
      style={{ overflowAnchor: 'none' }}
    >
      <div ref={sentinelRef} className="h-px shrink-0" />

      {isFetchingNextPage && (
        <div className="py-2 text-center text-[11px] font-mono text-muted-foreground animate-pulse">
          loading older messages…
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs font-mono text-muted-foreground animate-pulse">
            loading…
          </span>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">
            No messages yet. Say hello!
          </span>
        </div>
      ) : (
        <div className="py-1">
          {messages.map(msg => (
            <MessageRow
              key={msg.id}
              msg={msg}
              meId={meId}
              myRole={myRole ?? null}
              replyToMsg={msg.replyToMessageId ? messageIndex.get(msg.replyToMessageId) : undefined}
              onReply={onReply}
              onEditStart={onEditStart}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <div ref={bottomRef} className="shrink-0" />
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────

type RowProps = {
  msg: MessageDto | OptimisticMessage
  meId?: string
  myRole: RoomRole | null
  replyToMsg?: MessageDto | OptimisticMessage
  onReply?: (ctx: ReplyContext) => void
  onEditStart?: (messageId: string, currentContent: string) => void
  onDelete?: (messageId: string) => void
}

const MessageRow = ({ msg, meId, myRole, replyToMsg, onReply, onEditStart, onDelete }: RowProps) => {
  const isPending = 'pending' in msg && msg.pending
  const isDeleted = !!msg.deletedAt

  return (
    <div
      className={`flex gap-2.5 px-4 py-1 hover:bg-muted/20 transition-colors group ${isPending ? 'opacity-50' : ''}`}
    >
      {/* Avatar */}
      <div
        className={`mt-0.5 h-7 w-7 shrink-0 rounded text-[11px] font-bold text-white flex items-center justify-center select-none ${
          isDeleted ? 'bg-muted-foreground/30' : avatarColor(msg.authorUsername)
        }`}
      >
        {msg.authorUsername[0].toUpperCase()}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 leading-none">
          <span className={`text-sm font-semibold leading-none ${isDeleted ? 'text-muted-foreground' : ''}`}>
            {msg.authorUsername}
          </span>
          {msg.authorId && !isDeleted && (
            <PresenceIndicator userId={msg.authorId} className="self-center mb-px" />
          )}
          <span className="text-[10px] font-mono text-muted-foreground/70 leading-none">
            {isPending ? 'sending…' : formatTime(msg.sentAt)}
          </span>
          {msg.editedAt && !isDeleted && (
            <span className="text-[10px] font-mono text-muted-foreground/50 leading-none italic">
              edited
            </span>
          )}
        </div>

        {/* Reply quote block */}
        {replyToMsg && !isDeleted && (
          <div className="mt-0.5 mb-1 flex items-start gap-1.5 pl-1 border-l-2 border-muted-foreground/30">
            <Reply className="h-3 w-3 text-muted-foreground/50 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <span className="text-[11px] font-mono font-semibold text-muted-foreground">
                {replyToMsg.authorUsername}
              </span>
              <p className="text-[11px] font-mono text-muted-foreground truncate">
                {replyToMsg.deletedAt ? '[deleted]' : replyToMsg.content}
              </p>
            </div>
          </div>
        )}

        {/* Message body */}
        {isDeleted ? (
          <p className="mt-0.5 text-sm text-muted-foreground/50 italic">
            [Message deleted]
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
            {msg.content}
          </p>
        )}
      </div>

      {/* Actions — only for non-pending, non-optimistic messages */}
      {!isPending && meId && (
        <div className="shrink-0 self-start pt-0.5">
          <MessageEditMenu
            messageId={msg.id}
            authorId={msg.authorId}
            meId={meId}
            myRole={myRole}
            deletedAt={msg.deletedAt}
            onReply={() =>
              onReply?.({
                messageId: msg.id,
                username: msg.authorUsername,
                content: msg.content,
              })
            }
            onEdit={() => onEditStart?.(msg.id, msg.content)}
            onDelete={() => onDelete?.(msg.id)}
          />
        </div>
      )}
    </div>
  )
}
