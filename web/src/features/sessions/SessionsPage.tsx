import { Monitor, Smartphone, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSessions, useRevokeSession } from './useSessions'
import type { SessionDto } from './types'

function browserLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser'
  if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) return 'Chrome'
  if (/Firefox/i.test(userAgent)) return 'Firefox'
  if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) return 'Safari'
  if (/Edg/i.test(userAgent)) return 'Edge'
  return 'Browser'
}

function deviceIcon(userAgent: string | null) {
  if (!userAgent) return <Monitor className="h-4 w-4" />
  if (/Mobile|Android|iPhone/i.test(userAgent)) return <Smartphone className="h-4 w-4" />
  return <Monitor className="h-4 w-4" />
}

function SessionRow({ session, onRevoke }: { session: SessionDto; onRevoke: () => void }) {
  const browser = browserLabel(session.userAgent)
  const lastSeen = new Date(session.lastSeenAt).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${
      session.isCurrent ? 'border-emerald-500/40 bg-emerald-500/5' : 'bg-muted/10'
    }`}>
      <div className="mt-0.5 text-muted-foreground shrink-0">
        {deviceIcon(session.userAgent)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-semibold">{browser}</span>
          {session.isCurrent && (
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 rounded px-1">
              this device
            </span>
          )}
        </div>
        {session.ipAddress && (
          <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{session.ipAddress}</p>
        )}
        <p className="text-[11px] font-mono text-muted-foreground/60">Last seen {lastSeen}</p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
        onClick={onRevoke}
        aria-label={session.isCurrent ? 'Sign out' : 'Revoke session'}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export default function SessionsPage() {
  const { data, isLoading } = useSessions()
  const { mutate: revoke } = useRevokeSession()

  const sessions = data?.items ?? []
  const current = sessions.filter(s => s.isCurrent)
  const others = sessions.filter(s => !s.isCurrent)

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
      <h1 className="text-lg font-mono font-semibold mb-6">Active sessions</h1>

      {isLoading ? (
        <p className="text-xs font-mono text-muted-foreground animate-pulse">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground font-mono">No active sessions.</p>
      ) : (
        <div className="space-y-4">
          {current.length > 0 && (
            <section>
              <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                Current session
              </h2>
              <div className="space-y-1.5">
                {current.map(s => (
                  <SessionRow key={s.id} session={s} onRevoke={() => revoke(s.id)} />
                ))}
              </div>
            </section>
          )}
          {others.length > 0 && (
            <section>
              <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
                Other sessions ({others.length})
              </h2>
              <div className="space-y-1.5">
                {others.map(s => (
                  <SessionRow key={s.id} session={s} onRevoke={() => revoke(s.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
