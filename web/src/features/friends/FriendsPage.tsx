import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlus, Check, X, MessageSquare, Ban, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import { useOpenDmThread } from '@/features/dms/useDms'
import {
  useFriends,
  useFriendRequests,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useRemoveFriend,
  useBanUser,
  useUnbanUser,
} from './useFriends'
import SendFriendRequestDialog from './SendFriendRequestDialog'

export default function FriendsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const navigate = useNavigate()

  const { data: friendsData, isLoading: loadingFriends } = useFriends()
  const { data: requestsData, isLoading: loadingRequests } = useFriendRequests()
  const { mutate: accept } = useAcceptFriendRequest()
  const { mutate: decline } = useDeclineFriendRequest()
  const { mutate: remove } = useRemoveFriend()
  const { mutate: ban } = useBanUser()
  const { mutate: unban } = useUnbanUser()
  const { mutate: openDm } = useOpenDmThread()

  const friends = friendsData?.items ?? []
  const incoming = requestsData?.incoming ?? []
  const outgoing = requestsData?.outgoing ?? []

  const handleOpenDm = (userId: string) => {
    openDm(userId, {
      onSuccess: thread => navigate(`/dms/${thread.id}`),
    })
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-mono font-semibold">Contacts</h1>
        <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 font-mono text-xs">
          <UserPlus className="h-3.5 w-3.5" />
          Add contact
        </Button>
      </div>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
            Incoming requests ({incoming.length})
          </h2>
          <div className="space-y-1.5">
            {incoming.map(req => (
              <div
                key={req.userId}
                className="flex items-center gap-3 rounded-md border px-3 py-2 bg-muted/10"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-mono font-semibold">{req.username}</span>
                  {req.message && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{req.message}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                    onClick={() => accept(req.userId)}
                    aria-label="Accept"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => decline(req.userId)}
                    aria-label="Decline"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
            Sent requests ({outgoing.length})
          </h2>
          <div className="space-y-1.5">
            {outgoing.map(req => (
              <div
                key={req.userId}
                className="flex items-center gap-3 rounded-md border px-3 py-2 bg-muted/10"
              >
                <span className="flex-1 text-sm font-mono font-semibold text-muted-foreground">
                  {req.username}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground/60 shrink-0">pending</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Friends list */}
      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
          Friends {friends.length > 0 ? `(${friends.length})` : ''}
        </h2>

        {loadingFriends || loadingRequests ? (
          <p className="text-xs font-mono text-muted-foreground animate-pulse">Loading…</p>
        ) : friends.length === 0 && incoming.length === 0 && outgoing.length === 0 ? (
          <p className="text-sm text-muted-foreground font-mono">
            No contacts yet. Add someone by username.
          </p>
        ) : friends.length === 0 ? null : (
          <div className="space-y-1.5">
            {friends.map(f => (
              <div
                key={f.userId}
                className="flex items-center gap-3 rounded-md border px-3 py-2 bg-muted/10"
              >
                <PresenceIndicator userId={f.userId} />
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-mono font-semibold ${f.isBannedBy ? 'text-muted-foreground' : ''}`}>
                    {f.username}
                  </span>
                  {f.isBanned && (
                    <span className="ml-2 text-[10px] font-mono text-destructive/70">blocked</span>
                  )}
                  {f.isBannedBy && (
                    <span className="ml-2 text-[10px] font-mono text-muted-foreground/50">blocked you</span>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  {!f.isBanned && !f.isBannedBy && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => handleOpenDm(f.userId)}
                      aria-label="Message"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-7 w-7 ${f.isBanned ? 'text-amber-500 hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10'}`}
                    onClick={() => f.isBanned ? unban(f.userId) : ban(f.userId)}
                    aria-label={f.isBanned ? 'Unblock' : 'Block'}
                    title={f.isBanned ? 'Unblock user' : 'Block user'}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => remove(f.userId)}
                    aria-label="Remove friend"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <SendFriendRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
