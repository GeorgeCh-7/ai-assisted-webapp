import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { useForgotPassword } from './useAuth'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const { mutate, isPending, error, data } = useForgotPassword()

  const errorMessage =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutate(email)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base font-mono">Reset password</CardTitle>
          <CardDescription className="text-xs">
            Enter your email and we'll generate a reset token.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data ? (
            <div className="space-y-3">
              <p className="text-xs font-mono text-muted-foreground">
                Your reset token (use on the reset page):
              </p>
              <div className="rounded border bg-muted/30 px-3 py-2 font-mono text-xs break-all select-all">
                {data.resetToken}
              </div>
              <p className="text-[11px] font-mono text-muted-foreground/60">
                Expires {new Date(data.expiresAt).toLocaleTimeString()}
              </p>
              <Button asChild variant="outline" className="w-full font-mono text-xs">
                <Link to="/auth/reset-password">Go to reset page →</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-mono font-medium" htmlFor="email">Email</label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>
              {errorMessage && <p className="text-xs text-destructive font-mono">{errorMessage}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Sending…' : 'Get reset token'}
              </Button>
              <p className="text-center text-xs text-muted-foreground font-mono">
                <Link to="/login" className="hover:underline">Back to sign in</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
