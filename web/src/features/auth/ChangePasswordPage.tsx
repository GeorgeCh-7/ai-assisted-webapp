import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { useChangePassword } from './useAuth'

export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { mutate, isPending, error, isSuccess } = useChangePassword()

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mismatch) return
    mutate({ currentPassword, newPassword })
  }

  if (isSuccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400">Password changed.</p>
          <Button size="sm" variant="ghost" onClick={() => navigate(-1)} className="font-mono text-xs">
            ← Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono">Change password</CardTitle>
          <CardDescription className="text-xs">Enter your current password to set a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-mono font-medium" htmlFor="current">Current password</label>
              <Input
                id="current"
                type="password"
                placeholder="••••••"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                disabled={isPending}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono font-medium" htmlFor="new">New password</label>
              <Input
                id="new"
                type="password"
                placeholder="••••••"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={isPending}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono font-medium" htmlFor="confirm">Confirm new password</label>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={isPending}
                className={mismatch ? 'border-destructive' : ''}
                required
              />
              {mismatch && <p className="text-[11px] text-destructive font-mono">Passwords don't match</p>}
            </div>
            {errorMessage && <p className="text-xs text-destructive font-mono">{errorMessage}</p>}
            <Button type="submit" className="w-full" disabled={isPending || mismatch}>
              {isPending ? 'Saving…' : 'Change password'}
            </Button>
            <Button type="button" variant="ghost" className="w-full text-xs font-mono" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
