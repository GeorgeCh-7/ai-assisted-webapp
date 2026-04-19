import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, Shield, Ban, Mail, Wrench } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import PresenceIndicator from '@/features/presence/PresenceIndicator'
import {
  useRoomMembers,
  useRoomBans,
  usePromoteMember,
  useDemoteMember,
  useBanMember,
  useUnbanMember,
  useDeleteRoom,
} from './useRoomModeration'
import { useSendInvitation } from './useRoomInvitations'
import type { RoomDto, RoomRole } from './types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  room: RoomDto
  myRole: RoomRole
  meId: string
}

export default function RoomSettingsModal({ open, onOpenChange, room, myRole, meId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            <span className="text-emerald-600 dark:text-emerald-400">#</span>
            {room.name} — Settings
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="members" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="shrink-0 justify-start h-8 gap-1 bg-transparent border-b rounded-none px-0">
            <TabsTrigger value="members" className="h-7 text-xs font-mono gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
              <Shield className="h-3 w-3" />Members
            </TabsTrigger>
            {(myRole === 'owner') && (
              <TabsTrigger value="admins" className="h-7 text-xs font-mono gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                <Settings className="h-3 w-3" />Admins
              </TabsTrigger>
            )}
            {(myRole === 'owner' || myRole === 'admin') && (
              <>
                <TabsTrigger value="banned" className="h-7 text-xs font-mono gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                  <Ban className="h-3 w-3" />Banned
                </TabsTrigger>
                {room.isPrivate && (
                  <TabsTrigger value="invitations" className="h-7 text-xs font-mono gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                    <Mail className="h-3 w-3" />Invitations
                  </TabsTrigger>
                )}
              </>
            )}
            {myRole === 'owner' && (
              <TabsTrigger value="settings" className="h-7 text-xs font-mono gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-foreground rounded-none">
                <Wrench className="h-3 w-3" />Settings
              </TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-2">
            <TabsContent value="members" className="mt-0">
              <MembersTab roomId={room.id} myRole={myRole} meId={meId} />
            </TabsContent>
            <TabsContent value="admins" className="mt-0">
              <AdminsTab roomId={room.id} meId={meId} />
            </TabsContent>
            <TabsContent value="banned" className="mt-0">
              <BannedTab roomId={room.id} myRole={myRole} />
            </TabsContent>
            <TabsContent value="invitations" className="mt-0">
              <InvitationsTab roomId={room.id} />
            </TabsContent>
            <TabsContent value="settings" className="mt-0">
              <SettingsTab room={room} onClose={() => onOpenChange(false)} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ── Members tab ───────────────────────────────────────────────────────────────

function MembersTab({ roomId, myRole, meId }: { roomId: string; myRole: RoomRole; meId: string }) {
  const { data, isLoading } = useRoomMembers(roomId)
  const { mutate: ban, isPending: banning } = useBanMember(roomId)

  if (isLoading) return <LoadingRow />

  return (
    <div className="divide-y divide-border/50">
      {data?.items.map(member => (
        <div key={member.userId} className="flex items-center gap-2 py-2 px-1">
          <PresenceIndicator userId={member.userId} />
          <span className="flex-1 text-sm font-mono truncate">{member.username}</span>
          <RoleBadge role={member.role} />
          {(myRole === 'owner' || (myRole === 'admin' && member.role === 'member')) &&
           member.userId !== meId && member.role !== 'owner' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] font-mono px-2 text-destructive hover:bg-destructive/10"
              disabled={banning}
              onClick={() => ban({ userId: member.userId })}
            >
              ban
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Admins tab ────────────────────────────────────────────────────────────────

function AdminsTab({ roomId, meId }: { roomId: string; meId: string }) {
  const { data, isLoading } = useRoomMembers(roomId)
  const { mutate: promote, isPending: promoting } = usePromoteMember(roomId)
  const { mutate: demote, isPending: demoting } = useDemoteMember(roomId)
  const busy = promoting || demoting

  if (isLoading) return <LoadingRow />

  const members = data?.items ?? []
  const eligibleMembers = members.filter(m => m.role === 'member' && m.userId !== meId)
  const currentAdmins = members.filter(m => m.role === 'admin')

  return (
    <div className="space-y-4">
      {currentAdmins.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
            Current admins
          </p>
          <div className="divide-y divide-border/50">
            {currentAdmins.map(m => (
              <div key={m.userId} className="flex items-center gap-2 py-2 px-1">
                <span className="flex-1 text-sm font-mono">{m.username}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] font-mono px-2 text-muted-foreground"
                  disabled={busy}
                  onClick={() => demote(m.userId)}
                >
                  demote
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {eligibleMembers.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
            Promote a member
          </p>
          <div className="divide-y divide-border/50">
            {eligibleMembers.map(m => (
              <div key={m.userId} className="flex items-center gap-2 py-2 px-1">
                <span className="flex-1 text-sm font-mono">{m.username}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] font-mono px-2"
                  disabled={busy}
                  onClick={() => promote(m.userId)}
                >
                  promote
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Banned tab ────────────────────────────────────────────────────────────────

function BannedTab({ roomId, myRole }: { roomId: string; myRole: RoomRole }) {
  const { data, isLoading } = useRoomBans(roomId)
  const { mutate: unban, isPending } = useUnbanMember(roomId)

  if (isLoading) return <LoadingRow />
  if (!data?.items.length) {
    return (
      <p className="text-xs text-muted-foreground font-mono px-1 py-2">No banned users.</p>
    )
  }

  return (
    <div className="divide-y divide-border/50">
      {data.items.map(ban => (
        <div key={ban.userId} className="py-2 px-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-mono">{ban.username}</span>
            {(myRole === 'owner' || myRole === 'admin') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] font-mono px-2"
                disabled={isPending}
                onClick={() => unban(ban.userId)}
              >
                unban
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
            Banned by {ban.bannedByUsername}
            {ban.reason ? ` — ${ban.reason}` : ''}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Invitations tab ───────────────────────────────────────────────────────────

function InvitationsTab({ roomId }: { roomId: string }) {
  const [username, setUsername] = useState('')
  const [sent, setSent] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const { mutate: sendInvite, isPending } = useSendInvitation(roomId)

  const handleSend = () => {
    const trimmed = username.trim()
    if (!trimmed) return
    setError(null)
    sendInvite(trimmed, {
      onSuccess: () => {
        setSent(prev => [...prev, trimmed])
        setUsername('')
      },
      onError: (err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to send invitation')
      },
    })
  }

  return (
    <div className="space-y-3 px-1">
      <div className="flex gap-2">
        <Input
          placeholder="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          className="font-mono text-sm h-8"
          disabled={isPending}
        />
        <Button size="sm" className="h-8 text-xs font-mono" disabled={isPending || !username.trim()} onClick={handleSend}>
          {isPending ? '…' : 'Invite'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {sent.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
            Invitations sent this session
          </p>
          {sent.map(u => (
            <p key={u} className="text-xs font-mono text-muted-foreground">✓ {u}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ room, onClose }: { room: RoomDto; onClose: () => void }) {
  const navigate = useNavigate()
  const { mutate: deleteRoom, isPending } = useDeleteRoom()
  const [confirm, setConfirm] = useState('')

  const handleDelete = () => {
    deleteRoom(room.id, {
      onSuccess: () => {
        onClose()
        navigate('/rooms')
      },
    })
  }

  return (
    <div className="space-y-6 px-1">
      <div>
        <p className="text-xs font-mono text-muted-foreground mb-1">Room ID</p>
        <p className="text-xs font-mono bg-muted/40 rounded px-2 py-1 break-all">{room.id}</p>
      </div>
      <div className="border border-destructive/40 rounded p-3 space-y-3">
        <p className="text-xs font-semibold text-destructive">Danger zone</p>
        <p className="text-xs text-muted-foreground">
          Deleting this room permanently removes all messages and files. Type the room name to confirm.
        </p>
        <Input
          placeholder={room.name}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="font-mono text-sm h-8"
        />
        <Button
          variant="destructive"
          size="sm"
          className="text-xs font-mono h-7"
          disabled={confirm !== room.name || isPending}
          onClick={handleDelete}
        >
          {isPending ? 'Deleting…' : 'Delete room'}
        </Button>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: RoomRole }) {
  if (role === 'owner')
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-mono text-amber-600 border-amber-400/50">
        owner
      </Badge>
    )
  if (role === 'admin')
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-mono text-sky-600 border-sky-400/50">
        admin
      </Badge>
    )
  return null
}

function LoadingRow() {
  return (
    <div className="py-6 text-center text-xs font-mono text-muted-foreground animate-pulse">
      loading…
    </div>
  )
}
