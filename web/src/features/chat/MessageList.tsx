import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-600',
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-600', 'bg-sky-500',
  'bg-blue-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-pink-500',
] as const

function avatarColor(username: string): string {
  let h = 0
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function dicebearUrl(displayName: string): string {
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(displayName)}`
}

const API_URL = import.meta.env.VITE_API_URL as string

function SmartAvatar({ authorId, username, isDeleted }: { authorId: string | null; username: string; isDeleted: boolean }) {
  const displayName = username.startsWith('xmpp:') ? username.slice(5) : username
  const customSrc = authorId ? `${API_URL}/api/users/${authorId}/avatar` : null
  const [src, setSrc] = useState(customSrc ?? dicebearUrl(displayName))
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={`h-9 w-9 shrink-0 rounded-full text-[13px] font-bold text-white flex items-center justify-center select-none ${isDeleted ? 'bg-muted-foreground/30' : avatarColor(username)}`}>
        {displayName[0]?.toUpperCase() ?? '?'}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={displayName}
      className={`h-9 w-9 rounded-full object-cover select-none shrink-0 ${isDeleted ? 'opacity-30' : ''}`}
      onError={() => {
        if (customSrc && src === customSrc) setSrc(dicebearUrl(displayName))
        else setFailed(true)
      }}
    />
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

// Break into a new group if: different author, reply message, or >7 min gap
function shouldBreakGroup(
  prev: MessageDto | OptimisticMessage,
  curr: MessageDto | OptimisticMessage,
): boolean {
  if (prev.authorId !== curr.authorId) return true
  if (curr.replyToMessageId) return true
  const gap = new Date(curr.sentAt).getTime() - new Date(prev.sentAt).getTime()
  return gap > 7 * 60 * 1000
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
    if (delta > 0 && prevScrollHeightRef.current > 0) el.scrollTop += delta
    prevScrollHeightRef.current = el.scrollHeight
  })

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          const el = containerRef.current
          if (el) prevScrollHeightRef.current = el.scrollHeight
          fetchNextPage()
        }
      },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNextPage, isFetchingNextPage])

  const messageIndex = new Map(messages.map(m => [m.id, m]))

  // Determine which messages are first in their group
  const isFirstInGroup = new Set<string>()
  for (let i = 0; i < messages.length; i++) {
    const prev = messages[i - 1]
    const curr = messages[i]
    if (!prev || shouldBreakGroup(prev, curr)) {
      isFirstInGroup.add(curr.id)
    }
  }

  // Date separator tracking
  const shownDates = new Set<string>()

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto min-h-0 flex flex-col [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
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
          <span className="text-xs font-mono text-muted-foreground animate-pulse">loading…</span>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">No messages yet. Say hello!</span>
        </div>
      ) : (
        <div className="py-2">
          {messages.map(msg => {
            const dateKey = new Date(msg.sentAt).toDateString()
            const showDate = !shownDates.has(dateKey)
            if (showDate) shownDates.add(dateKey)
            const first = isFirstInGroup.has(msg.id)

            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[11px] font-mono text-muted-foreground/60 shrink-0">
                      {formatDateHeader(msg.sentAt)}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <MessageRow
                  msg={msg}
                  isFirst={first}
                  meId={meId}
                  myRole={myRole ?? null}
                  replyToMsg={msg.replyToMessageId ? messageIndex.get(msg.replyToMessageId) : undefined}
                  onReply={onReply}
                  onEditStart={onEditStart}
                  onDelete={onDelete}
                />
              </div>
            )
          })}
        </div>
      )}

      <div ref={bottomRef} className="shrink-0" />
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────

type RowProps = {
  msg: MessageDto | OptimisticMessage
  isFirst: boolean
  meId?: string
  myRole: RoomRole | null
  replyToMsg?: MessageDto | OptimisticMessage
  onReply?: (ctx: ReplyContext) => void
  onEditStart?: (messageId: string, currentContent: string) => void
  onDelete?: (messageId: string) => void
}

const MessageRow = ({ msg, isFirst, meId, myRole, replyToMsg, onReply, onEditStart, onDelete }: RowProps) => {
  const isPending = 'pending' in msg && msg.pending
  const isDeleted = !!msg.deletedAt
  const isMe = !!meId && msg.authorId === meId
  const displayName = msg.authorUsername.startsWith('xmpp:')
    ? msg.authorUsername.slice(5)
    : msg.authorUsername

  return (
    <div
      className={`group relative flex gap-4 px-4 hover:bg-muted/20 transition-colors ${
        isFirst ? 'pt-3 pb-0.5' : 'py-0.5'
      } ${isPending ? 'opacity-60' : ''}`}
    >
      {/* Avatar column — 36px wide, always reserved */}
      <div className="w-9 shrink-0 flex flex-col items-center">
        {isFirst ? (
          <SmartAvatar authorId={msg.authorId} username={msg.authorUsername} isDeleted={isDeleted} />
        ) : (
          // Hover timestamp for grouped messages
          <span className="text-[10px] font-mono text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity mt-1 w-full text-right leading-tight">
            {formatTime(msg.sentAt)}
          </span>
        )}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Header — only first in group */}
        {isFirst && (
          <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
            <span className={`text-sm font-semibold leading-tight ${
              isMe ? 'text-emerald-500 dark:text-emerald-400' : 'text-foreground'
            }`}>
              {displayName}
            </span>
            {msg.authorUsername.startsWith('xmpp:') && (
              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-indigo-600/30 text-indigo-300 leading-none">
                via Jabber
              </span>
            )}
            {msg.authorId && !isDeleted && (
              <PresenceIndicator userId={msg.authorId} className="self-center" />
            )}
            <span className="text-[11px] font-mono text-muted-foreground/50">
              {isPending ? 'sending…' : formatTime(msg.sentAt)}
            </span>
          </div>
        )}

        {/* Reply quote */}
        {replyToMsg && !isDeleted && (
          <div className="mb-1 flex items-start gap-1.5 pl-2 border-l-2 border-muted-foreground/30">
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

        {/* Message content */}
        {isDeleted ? (
          <p className="text-sm text-muted-foreground/40 italic">[Message deleted]</p>
        ) : (
          <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
            {msg.content}
            {msg.attachments.map(a => (
              <FileAttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}

        {/* Edited tag */}
        {msg.editedAt && !isDeleted && (
          <span className="text-[10px] font-mono text-muted-foreground/40 italic"> (edited)</span>
        )}
      </div>

      {/* Actions — appear on hover */}
      {!isPending && meId && (
        <div className="absolute right-4 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <MessageEditMenu
            messageId={msg.id}
            authorId={msg.authorId}
            meId={meId}
            myRole={myRole}
            deletedAt={msg.deletedAt}
            onReply={() => onReply?.({ messageId: msg.id, username: msg.authorUsername, content: msg.content })}
            onEdit={() => onEditStart?.(msg.id, msg.content)}
            onDelete={() => onDelete?.(msg.id)}
          />
        </div>
      )}
    </div>
  )
}
