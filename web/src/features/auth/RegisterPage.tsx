import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { useRegister, useLogin } from './useAuth'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const { mutate: register, isPending: registering, error: registerError } = useRegister()
  const { mutate: login, isPending: loggingIn } = useLogin()

  const isPending = registering || loggingIn
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const errorMessage =
    registerError instanceof ApiError
      ? registerError.message
      : registerError
        ? 'Something went wrong'
        : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (passwordMismatch) return
    register(
      { username, email, password },
      {
        onSuccess: () => {
          login({ email, password }, { onSuccess: () => navigate('/rooms') })
        },
      },
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Create account</CardTitle>
          <CardDescription>Choose a username and set up your credentials</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="username">
                Username
              </label>
              <Input
                id="username"
                type="text"
                placeholder="yourname"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Min. 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="confirm-password">
                Confirm password
              </label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                disabled={isPending}
                className={passwordMismatch ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              {passwordMismatch && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={isPending || passwordMismatch}
            >
              {isPending ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
