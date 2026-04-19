import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import { useSendFriendRequest } from './useFriends'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SendFriendRequestDialog({ open, onOpenChange }: Props) {
  const [username, setUsername] = useState('')
  const { mutate, isPending, error, reset } = useSendFriendRequest()

  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return
    mutate(
      { username: username.trim() },
      {
        onSuccess: () => {
          setUsername('')
          reset()
          onOpenChange(false)
        },
      },
    )
  }

  const handleOpenChange = (val: boolean) => {
    if (!val) { setUsername(''); reset() }
    onOpenChange(val)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Send friend request</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-1">
          <Input
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={isPending}
            autoFocus
            className="font-mono text-sm"
          />
          {errorMessage && (
            <p className="text-xs text-destructive font-mono">{errorMessage}</p>
          )}
          <Button type="submit" className="w-full" disabled={isPending || !username.trim()}>
            {isPending ? 'Sending…' : 'Send request'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
