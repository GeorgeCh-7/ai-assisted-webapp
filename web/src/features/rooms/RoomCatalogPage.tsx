import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useRooms, useJoinRoom, useLeaveRoom } from './useRooms'
import CreateRoomModal from './CreateRoomModal'
import type { RoomDto } from './types'

export default function RoomCatalogPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useRooms(debouncedSearch)

  const rooms = data?.pages.flatMap(p => p.items) ?? []

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-muted/20">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-mono text-sm font-semibold tracking-tight">
              Public Rooms
            </h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {isLoading
                ? 'loading…'
                : `${rooms.length} room${rooms.length !== 1 ? 's' : ''}${debouncedSearch ? ` matching "${debouncedSearch}"` : ''}`}
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New room
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b bg-background">
        <div className="mx-auto max-w-2xl px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 h-8 text-sm font-mono bg-muted/30 border-muted"
              placeholder="filter rooms…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div className="border-b bg-muted/10">
        <div className="mx-auto max-w-2xl px-4 py-1 flex items-center gap-2">
          <span className="flex-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
            room
          </span>
          <span className="w-16 text-right text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
            users
          </span>
          <span className="w-28" />
        </div>
      </div>

      {/* Room list */}
      <div className="mx-auto max-w-2xl w-full flex-1">
        {isLoading ? (
          <div className="py-12 text-center text-xs font-mono text-muted-foreground animate-pulse">
            connecting…
          </div>
        ) : rooms.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {debouncedSearch ? `No rooms matching "${debouncedSearch}".` : 'No rooms yet.'}
            </p>
            {!debouncedSearch && (
              <Button
                variant="link"
                size="sm"
                className="mt-1 text-xs"
                onClick={() => setIsCreateOpen(true)}
              >
                Create the first one →
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {rooms.map(room => (
              <RoomRow key={room.id} room={room} />
            ))}
          </div>
        )}

        {hasNextPage && (
          <div className="border-t px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-[11px] font-mono text-muted-foreground hover:text-foreground"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'loading…' : '↓ load more'}
            </Button>
          </div>
        )}
      </div>

      <CreateRoomModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  )
}

// ── Room row ──────────────────────────────────────────────────────────────────

type RoomRowProps = { room: RoomDto }

const RoomRow = ({ room }: RoomRowProps) => {
  const { mutate: join, isPending: joining } = useJoinRoom()
  const { mutate: leave, isPending: leaving } = useLeaveRoom()
  const busy = joining || leaving

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors">
      {/* Room name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {room.isMember ? (
            <Link
              to={`/rooms/${room.id}`}
              className="text-sm font-mono font-semibold hover:underline underline-offset-2 truncate"
            >
              <span className="text-emerald-600 dark:text-emerald-500">#</span>
              {room.name}
            </Link>
          ) : (
            <span className="text-sm font-mono text-muted-foreground truncate">
              <span className="text-muted-foreground/50">#</span>
              {room.name}
            </span>
          )}
          {room.myRole === 'owner' && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 font-mono shrink-0 text-amber-600 border-amber-400/50 dark:text-amber-400"
            >
              owner
            </Badge>
          )}
          {room.myRole === 'member' && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1 py-0 h-4 font-mono shrink-0"
            >
              member
            </Badge>
          )}
        </div>
        {room.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5 ml-0">
            {room.description}
          </p>
        )}
      </div>

      {/* Member count */}
      <div className="w-16 flex items-center justify-end gap-1 shrink-0">
        <Users className="h-3 w-3 text-muted-foreground/50" />
        <span className="text-xs font-mono text-muted-foreground">{room.memberCount}</span>
      </div>

      {/* Actions */}
      <div className="w-28 flex items-center justify-end gap-1 shrink-0">
        {room.isMember ? (
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-6 text-[11px] font-mono px-2"
            >
              <Link to={`/rooms/${room.id}`}>open</Link>
            </Button>
            {room.myRole !== 'owner' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] font-mono px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => leave(room.id)}
                disabled={busy}
              >
                leave
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] font-mono px-3"
            onClick={() => join(room.id)}
            disabled={busy}
          >
            {joining ? '…' : 'join'}
          </Button>
        )}
      </div>
    </div>
  )
}
