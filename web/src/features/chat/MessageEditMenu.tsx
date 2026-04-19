import { useState } from 'react'
import { MoreHorizontal, Edit, Trash2, Reply } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RoomRole } from '@/features/rooms/types'

type Props = {
  messageId: string
  authorId: string | null
  meId: string
  myRole: RoomRole | null
  deletedAt: string | null
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function MessageEditMenu({
  messageId: _messageId,
  authorId,
  meId,
  myRole,
  deletedAt,
  onReply,
  onEdit,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false)

  const isAuthor = authorId === meId
  const canEdit = isAuthor && !deletedAt
  const canDelete =
    !deletedAt && (isAuthor || myRole === 'admin' || myRole === 'owner')
  const canReply = !deletedAt

  if (!canReply && !canEdit && !canDelete) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Message actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {canReply && (
          <DropdownMenuItem
            className="gap-2 text-xs font-mono"
            onClick={() => { onReply(); setOpen(false) }}
          >
            <Reply className="h-3.5 w-3.5" />
            Reply
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem
            className="gap-2 text-xs font-mono"
            onClick={() => { onEdit(); setOpen(false) }}
          >
            <Edit className="h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
        )}
        {(canEdit || canReply) && canDelete && <DropdownMenuSeparator />}
        {canDelete && (
          <DropdownMenuItem
            className="gap-2 text-xs font-mono text-destructive focus:text-destructive"
            onClick={() => { onDelete(); setOpen(false) }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
