import { useEffect, useLayoutEffect, useRef } from 'react'
import { Reply } from 'lucide-react'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import MessageEditMenu from './MessageEditMenu'
import FileAttachmentView from '@/features/files/FileAttachmentView'
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
  const isMe = !!meId && msg.authorId === meId

  return (
    <div
      className={`flex items-end gap-2 px-4 py-0.5 group ${isPending ? 'opacity-50' : ''} ${isMe ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar — others only */}
      {!isMe && (
        <div
          className={`mb-0.5 h-7 w-7 shrink-0 rounded-full text-[11px] font-bold text-white flex items-center justify-center select-none ${
            isDeleted ? 'bg-muted-foreground/30' : avatarColor(msg.authorUsername)
          }`}
        >
          {msg.authorUsername[0].toUpperCase()}
        </div>
      )}

      {/* Bubble column */}
      <div className={`flex flex-col max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Username + meta — others only */}
        {!isMe && (
          <div className="flex items-baseline gap-1.5 mb-0.5 px-1">
            <span className={`text-xs font-semibold ${isDeleted ? 'text-muted-foreground' : ''}`}>
              {msg.authorUsername}
            </span>
            {msg.authorId && !isDeleted && (
              <PresenceIndicator userId={msg.authorId} className="self-center" />
            )}
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {isPending ? 'sending…' : formatTime(msg.sentAt)}
            </span>
            {msg.editedAt && !isDeleted && (
              <span className="text-[10px] font-mono text-muted-foreground/40 italic">edited</span>
            )}
          </div>
        )}

        {/* Reply quote */}
        {replyToMsg && !isDeleted && (
          <div className={`mb-1 flex items-start gap-1.5 pl-2 border-l-2 border-muted-foreground/30 ${isMe ? 'self-end' : ''}`}>
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

        {/* Bubble */}
        {isDeleted ? (
          <p className="text-sm text-muted-foreground/50 italic px-1">
            [Message deleted]
          </p>
        ) : (
          <div
            className={`px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
              isMe
                ? 'bg-emerald-700 text-white rounded-2xl rounded-br-sm'
                : 'bg-card text-foreground/90 rounded-2xl rounded-bl-sm'
            }`}
          >
            {msg.content}
            {msg.attachments.map(a => (
              <FileAttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}

        {/* Timestamp for own messages */}
        {isMe && !isDeleted && (
          <div className="flex items-center gap-1 mt-0.5 px-1">
            {msg.editedAt && (
              <span className="text-[10px] font-mono text-muted-foreground/40 italic">edited</span>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {isPending ? 'sending…' : formatTime(msg.sentAt)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {!isPending && meId && (
        <div className="shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity">
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
