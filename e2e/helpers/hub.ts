import * as signalR from '@microsoft/signalr'
import type { BrowserContext } from '@playwright/test'
import { API } from './auth'

export type HubHandle = {
  conn: signalR.HubConnection
  errors: unknown[]
}

export async function createHubConnection(context: BrowserContext): Promise<HubHandle> {
  const cookies = await context.cookies([API])
  const session = cookies.find(c => c.name === '.chat.session')
  if (!session) throw new Error('No .chat.session cookie — context must be logged in')

  const conn = new signalR.HubConnectionBuilder()
    .withUrl(`${API}/hubs/chat`, {
      headers: { Cookie: `${session.name}=${session.value}` },
    })
    .configureLogging(signalR.LogLevel.Error)
    .build()

  const errors: unknown[] = []
  conn.on('Error', e => errors.push(e))

  await conn.start()
  return { conn, errors }
}
