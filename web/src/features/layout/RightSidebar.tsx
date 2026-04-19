import { Link, useParams } from 'react-router-dom'
import { useRooms } from '@/features/rooms/useRooms'
import { useUnreadCount } from '@/hooks/useUnread'
import { Badge } from '@/components/ui/badge'

export default function RightSidebar() {
  const { roomId: activeRoomId } = useParams<{ roomId?: string }>()
  const { data } = useRooms('')

  const myRooms = (data?.pages.flatMap(p => p.items) ?? []).filter(r => r.isMember)

  return (
    <div className="w-52 border-l bg-muted/10 flex flex-col shrink-0 overflow-y-auto">
      <div className="px-2 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
        My Rooms
      </div>

      <div className="flex flex-col gap-0.5 px-1 pb-2">
        {myRooms.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground font-mono">No rooms</p>
        ) : (
          myRooms.map(room => (
            <SidebarRoomRow
              key={room.id}
              roomId={room.id}
              name={room.name}
              isActive={room.id === activeRoomId}
            />
          ))
        )}
      </div>

      {/* Contacts section — populated in Merge 2 */}
      <div className="mt-auto border-t px-2 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
        Contacts
      </div>
      <div className="px-3 pb-3 text-xs text-muted-foreground font-mono">
        <Link to="/friends" className="hover:underline underline-offset-2">
          Manage contacts →
        </Link>
      </div>
    </div>
  )
}

function SidebarRoomRow({
  roomId,
  name,
  isActive,
}: {
  roomId: string
  name: string
  isActive: boolean
}) {
  const unread = useUnreadCount(roomId)

  return (
    <Link
      to={`/rooms/${roomId}`}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-mono transition-colors hover:bg-muted/60 ${
        isActive ? 'bg-muted/70 text-foreground' : 'text-muted-foreground'
      }`}
    >
      <span className={`${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-50'}`}>
        #
      </span>
      <span className="flex-1 truncate">{name}</span>
      {unread > 0 && (
        <Badge className="h-3.5 min-w-3.5 px-1 text-[9px] font-mono bg-emerald-500 hover:bg-emerald-500 text-white">
          {unread > 99 ? '99+' : unread}
        </Badge>
      )}
    </Link>
  )
}
