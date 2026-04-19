import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import { useDmList } from './useDms'
import type { DmThreadListItem } from './types'

export default function DmListSidebar() {
  const { threadId: activeThreadId } = useParams<{ threadId?: string }>()
  const { data } = useDmList()
  const threads = data?.items ?? []

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
            <span className="flex-1 truncate">
              {t.otherUser.username}
              {isFrozen && <span className="ml-1 text-[9px] text-muted-foreground/50">frozen</span>}
            </span>
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
