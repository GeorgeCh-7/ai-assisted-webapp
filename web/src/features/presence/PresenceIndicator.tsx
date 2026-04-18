import { usePresence } from './usePresence'

type Props = {
  userId: string
  className?: string
}

export default function PresenceIndicator({ userId, className }: Props) {
  const { data: status = 'offline' } = usePresence(userId)
  const online = status === 'online'
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 transition-colors ${
        online ? 'bg-emerald-500' : 'bg-muted-foreground/30'
      } ${className ?? ''}`}
      title={status}
      aria-label={status}
    />
  )
}
