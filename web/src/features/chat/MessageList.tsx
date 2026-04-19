import { useEffect, useLayoutEffect, useRef } from 'react'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import type { MessageDto, OptimisticMessage } from './types'

type Props = {
  messages: (MessageDto | OptimisticMessage)[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  isLoading: boolean
}

// Derives a stable Tailwind bg color class from username — same username always
// gets the same color across renders without any external state
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef(0)
  const isInitialLoad = useRef(true)

  // Scroll to bottom on initial data load
  useEffect(() => {
    if (isLoading || messages.length === 0 || !isInitialLoad.current) return
    isInitialLoad.current = false
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [isLoading, messages.length])

  // Auto-scroll to bottom when a new message arrives (if the user is near the bottom)
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

  // Preserve scroll position when older messages are prepended (layout effect = before paint)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || isFetchingNextPage) return
    const delta = el.scrollHeight - prevScrollHeightRef.current
    if (delta > 0 && prevScrollHeightRef.current > 0) {
      el.scrollTop += delta
    }
    prevScrollHeightRef.current = el.scrollHeight
  })

  // Record scroll height just before fetchNextPage resolves
  const handleFetchMore = () => {
    const el = containerRef.current
    if (el) prevScrollHeightRef.current = el.scrollHeight
    fetchNextPage()
  }

  // Intersection observer on the top sentinel
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

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto min-h-0 flex flex-col"
      style={{ overflowAnchor: 'none' }} // manual scroll restoration above
    >
      {/* Top sentinel — triggers load of older messages */}
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
            <MessageRow key={msg.id} msg={msg} />
          ))}
        </div>
      )}

      {/* Invisible anchor for scroll-to-bottom */}
      <div ref={bottomRef} className="shrink-0" />
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────

const MessageRow = ({ msg }: { msg: MessageDto | OptimisticMessage }) => {
  const isPending = 'pending' in msg && msg.pending

  return (
    <div
      className={`flex gap-2.5 px-4 py-1 hover:bg-muted/20 transition-colors group ${isPending ? 'opacity-50' : ''}`}
    >
      {/* Avatar */}
      <div
        className={`mt-0.5 h-7 w-7 shrink-0 rounded text-[11px] font-bold text-white flex items-center justify-center select-none ${avatarColor(msg.authorUsername)}`}
      >
        {msg.authorUsername[0].toUpperCase()}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 leading-none">
          <span className="text-sm font-semibold leading-none">{msg.authorUsername}</span>
          {msg.authorId && <PresenceIndicator userId={msg.authorId} className="self-center mb-px" />}
          <span className="text-[10px] font-mono text-muted-foreground/70 leading-none">
            {isPending ? 'sending…' : formatTime(msg.sentAt)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
          {msg.content}
        </p>
      </div>
    </div>
  )
}
