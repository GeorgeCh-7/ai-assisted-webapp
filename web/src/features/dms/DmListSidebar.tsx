import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useQueryClient } from '@tanstack/react-query'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import { useDmList } from './useDms'
import type { DmThreadListItem } from './types'

export default function DmListSidebar() {
  const { threadId: activeThreadId } = useParams<{ threadId?: string }>()
  const { data } = useDmList()
  const threads = data?.items ?? []
  const qc = useQueryClient()

  // Seed presence cache from DM list API so contacts show online/offline immediately
  useEffect(() => {
    for (const t of threads) {
      qc.setQueryData(['presence', t.otherUser.userId], (old: unknown) =>
        old === undefined ? t.otherUser.presence : old,
      )
    }
  }, [threads, qc])

  if (threads.length === 0) return null

  return (
    <div className="flex flex-col gap-0.5 px-1 pb-2">
      {threads.map((t: DmThreadListItem) => {
        const isActive = t.id === activeThreadId
        const isFrozen = !!t.frozenAt || !!t.otherPartyDeletedAt

        return (
          <Link
            key={t.id}
            to={`/dms/${t.id}`}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-mono transition-colors hover:bg-secondary/40 ${
              isActive ? 'bg-secondary/50 text-foreground' : 'text-muted-foreground'
            }`}
          >
            <PresenceIndicator userId={t.otherUser.userId} />
            <span className="flex-1 truncate">{t.otherUser.username}</span>
            {isFrozen && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" title="Conversation frozen" />}
            {t.unreadCount > 0 && (
              <Badge className="h-3.5 min-w-3.5 px-1 text-[9px] font-mono bg-sky-500 hover:bg-sky-500 text-white">
                {t.unreadCount > 99 ? '99+' : t.unreadCount}
              </Badge>
            )}
          </Link>
        )
      })}
    </div>
  )
}
