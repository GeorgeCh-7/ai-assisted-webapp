import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5080'

type Health = { status: string; timestamp: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Health>
      })
      .then(setHealth)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Hackathon App</h1>
          <p className="text-muted-foreground text-sm mt-1">
            React + TS + Vite + Tailwind + shadcn-ready
          </p>
        </header>

        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="font-semibold mb-3">API Health</h2>
          {error && (
            <p className="text-destructive text-sm">Error: {error}</p>
          )}
          {health && (
            <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
              {JSON.stringify(health, null, 2)}
            </pre>
          )}
          {!health && !error && (
            <p className="text-muted-foreground text-sm">Loading…</p>
          )}
        </section>
      </div>
    </div>
  )
}
