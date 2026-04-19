export type HubLike = {
  readonly state: string
  start(): Promise<void>
  stop(): Promise<void>
  on(event: string, cb: (...args: unknown[]) => void): void
  off(event: string, cb?: (...args: unknown[]) => void): void
  invoke<T>(method: string, arg?: Record<string, unknown>): Promise<T>
  onreconnecting(cb: (error?: Error) => void): void
  onreconnected(cb: (connectionId?: string) => void): void
  onclose(cb: (error?: Error) => void): void
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export async function buildConnection(): Promise<HubLike> {
  if (import.meta.env.VITE_MSW_ENABLED === 'true') {
    const { createMockHubConnection } = await import('@/mocks/signalr')
    return createMockHubConnection() as unknown as HubLike
  }
  const apiUrl = import.meta.env.VITE_API_URL ?? ''
  const { HubConnectionBuilder } = await import('@microsoft/signalr')
  return new HubConnectionBuilder()
    .withUrl(`${apiUrl}/hubs/chat`, { withCredentials: true })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .build() as unknown as HubLike
}
