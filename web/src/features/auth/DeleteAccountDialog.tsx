import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import { useDeleteAccount } from './useAuth'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function DeleteAccountDialog({ open, onOpenChange }: Props) {
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const navigate = useNavigate()
  const { mutate, isPending, error, reset } = useDeleteAccount()

  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!confirmed || !password) return
    mutate(password, {
      onSuccess: () => navigate('/register'),
    })
  }

  const handleOpenChange = (val: boolean) => {
    if (!val) { setPassword(''); setConfirmed(false); reset() }
    onOpenChange(val)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm text-destructive">Delete account</DialogTitle>
          <DialogDescription className="text-xs">
            This permanently deletes your account and all owned rooms. DM history is preserved
            for your contacts in read-only form. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-1">
          <Input
            type="password"
            placeholder="Current password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={isPending}
            className="font-mono text-sm"
          />
          <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            I understand this is permanent and cannot be undone
          </label>
          {errorMessage && (
            <p className="text-xs text-destructive font-mono">{errorMessage}</p>
          )}
          <Button
            type="submit"
            variant="destructive"
            className="w-full"
            disabled={isPending || !confirmed || !password}
          >
            {isPending ? 'Deleting…' : 'Delete my account'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
