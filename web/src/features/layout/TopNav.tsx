import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, LogOut, UserCircle, Lock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMe, useLogout } from '@/features/auth/useAuth'
import { useInvitations, useAcceptInvitation, useDeclineInvitation } from '@/features/rooms/useRoomInvitations'
import { useFriendRequests } from '@/features/friends/useFriends'
import { useAfkTracker } from '@/features/presence/useAfkTracker'
import DeleteAccountDialog from '@/features/auth/DeleteAccountDialog'

const API_URL = import.meta.env.VITE_API_URL as string

function NavAvatar({ avatarUrl, username }: { avatarUrl: string | null; username: string }) {
  const src = avatarUrl
    ? `${API_URL}${avatarUrl}`
    : `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username)}`
  return (
    <img
      src={src}
      alt={username}
      className="h-4 w-4 rounded-full object-cover shrink-0"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

export default function TopNav() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const { mutate: logout } = useLogout()
  const { data: invitations } = useInvitations()
  const { mutate: accept } = useAcceptInvitation()
  const { mutate: decline } = useDeclineInvitation()
  const { data: friendRequests } = useFriendRequests()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useAfkTracker()

  const pendingCount = invitations?.items.length ?? 0
  const friendRequestCount = friendRequests?.incoming.length ?? 0

  const handleLogout = () => {
    logout(undefined, { onSuccess: () => navigate('/login') })
  }

  return (
    <nav className="h-10 border-b bg-muted flex items-center px-3 gap-4 shrink-0 z-20">
      {/* Logo */}
      <Link
        to="/rooms"
        className="font-mono text-sm font-bold tracking-tight text-emerald-600 dark:text-emerald-400 shrink-0"
      >
        ◈ Chat
      </Link>

      {/* Nav links */}
      <div className="flex items-center gap-0.5 text-xs font-mono">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono" asChild>
          <Link to="/rooms">Public Rooms</Link>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono" asChild>
          <Link to="/rooms?private=1">Private Rooms</Link>
        </Button>
        <Button variant="ghost" size="sm" className="relative h-7 px-2 text-xs font-mono" asChild>
          <Link to="/friends">
            Contacts
            {friendRequestCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 text-white text-[9px] font-mono flex items-center justify-center leading-none">
                {friendRequestCount > 9 ? '9+' : friendRequestCount}
              </span>
            )}
          </Link>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono" asChild>
          <Link to="/sessions">Sessions</Link>
        </Button>
      </div>

      <div className="flex-1" />

      {/* Invitation badge */}
      <DropdownMenu open={inviteOpen} onOpenChange={setInviteOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative h-7 w-7">
            <Bell className="h-3.5 w-3.5" />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 text-white text-[9px] font-mono flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          {pendingCount === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground font-mono">
              No pending invitations
            </div>
          ) : (
            invitations!.items.map(inv => (
              <div key={inv.id} className="px-3 py-2 flex flex-col gap-1.5 border-b last:border-0">
                <div className="text-xs font-mono">
                  <span className="font-semibold">{inv.invitedByUsername}</span>
                  {' invited you to '}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    #{inv.roomName}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-6 text-[11px] px-2 font-mono"
                    onClick={() => {
                      accept(inv.id, { onSuccess: () => navigate(`/rooms/${inv.roomId}`) })
                      setInviteOpen(false)
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 font-mono text-muted-foreground"
                    onClick={() => decline(inv.id)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Profile menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-mono gap-1.5">
            <NavAvatar avatarUrl={me?.avatarUrl ?? null} username={me?.username ?? ''} />
            {me?.username ?? '…'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/profile" className="gap-2">
              <UserCircle className="h-3.5 w-3.5" />
              Profile &amp; avatar
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/auth/change-password" className="gap-2">
              <Lock className="h-3.5 w-3.5" />
              Change password
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive gap-2"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete account
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive gap-2"
            onClick={handleLogout}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </nav>
  )
}
