import { X, Reply } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  replyToUsername: string
  replyToContent: string
  onDismiss: () => void
}

export default function ReplyQuoteBanner({ replyToUsername, replyToContent, onDismiss }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t bg-muted/30 shrink-0">
      <Reply className="h-3 w-3 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-mono font-semibold text-muted-foreground">
          Replying to {replyToUsername}
        </span>
        <p className="text-[11px] font-mono text-muted-foreground truncate">
          {replyToContent}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        onClick={onDismiss}
        aria-label="Cancel reply"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
