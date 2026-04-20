import { usePresence } from './usePresence'

type Props = {
  userId: string
  className?: string
}

export default function PresenceIndicator({ userId, className }: Props) {
  const { data: status = 'offline' } = usePresence(userId)
  const color =
    status === 'online' ? 'bg-emerald-500' :
    status === 'afk'    ? 'bg-amber-400' :
                          'bg-muted-foreground/30'
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 transition-colors ${color} ${className ?? ''}`}
      title={status}
      aria-label={status}
      data-presence={status}
    />
  )
}
