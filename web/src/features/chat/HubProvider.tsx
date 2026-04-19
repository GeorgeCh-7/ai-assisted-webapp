import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { buildConnection, type ConnectionState, type HubLike } from '@/lib/hub'

type ReconnectCallback = () => Promise<void>

type HubContextValue = {
  hub: HubLike | null
  connectionState: ConnectionState
  subscribeReconnect: (cb: ReconnectCallback) => () => void
}

const HubContext = createContext<HubContextValue | null>(null)

export function useHubContext(): HubContextValue {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('useHubContext must be used inside HubProvider')
  return ctx
}

export function HubProvider({ children }: { children: React.ReactNode }) {
  const [hub, setHub] = useState<HubLike | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const reconnectSubs = useRef<Set<ReconnectCallback>>(new Set())

  const subscribeReconnect = useCallback((cb: ReconnectCallback) => {
    reconnectSubs.current.add(cb)
    return () => { reconnectSubs.current.delete(cb) }
  }, [])

  useEffect(() => {
    let cancelled = false
    let connRef: HubLike | null = null

    setConnectionState('connecting')

    buildConnection()
      .then(async conn => {
        if (cancelled) { conn.stop(); return }
        connRef = conn

        conn.onreconnecting(() => {
          if (!cancelled) setConnectionState('reconnecting')
        })

        conn.onreconnected(async () => {
          if (cancelled) return
          const cbs = [...reconnectSubs.current]
          await Promise.allSettled(cbs.map(cb => cb()))
          if (!cancelled) setConnectionState('connected')
        })

        conn.onclose(() => {
          if (!cancelled) {
            setHub(null)
            setConnectionState('disconnected')
          }
        })

        await conn.start()
        if (cancelled) { conn.stop(); return }

        setHub(conn)
        setConnectionState('connected')
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[HubProvider]', err)
          setConnectionState('disconnected')
        }
      })

    return () => {
      cancelled = true
      connRef?.stop()
      setHub(null)
      setConnectionState('disconnected')
    }
  }, [])

  return (
    <HubContext.Provider value={{ hub, connectionState, subscribeReconnect }}>
      {children}
    </HubContext.Provider>
  )
}
