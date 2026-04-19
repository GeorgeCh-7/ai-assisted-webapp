import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { useResetPassword } from './useAuth'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { mutate, isPending, error, isSuccess } = useResetPassword()

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mismatch) return
    mutate({ token, newPassword })
  }

  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center space-y-3">
          <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
            Password reset. All sessions revoked.
          </p>
          <Button size="sm" onClick={() => navigate('/login')} className="font-mono text-xs">
            Sign in
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono">Set new password</CardTitle>
          <CardDescription className="text-xs">
            Paste your reset token and choose a new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-mono font-medium" htmlFor="token">Reset token</label>
              <Input
                id="token"
                placeholder="Paste token here"
                value={token}
                onChange={e => setToken(e.target.value)}
                disabled={isPending}
                className="font-mono text-xs"
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
              <label className="text-xs font-mono font-medium" htmlFor="confirm">Confirm password</label>
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
              {isPending ? 'Resetting…' : 'Reset password'}
            </Button>
            <p className="text-center text-xs text-muted-foreground font-mono">
              <Link to="/login" className="hover:underline">Back to sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
