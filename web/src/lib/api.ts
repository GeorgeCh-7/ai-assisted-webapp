const API_URL = import.meta.env.VITE_API_URL

function getCsrfToken(): string {
  const match = document.cookie
    .split('; ')
    .find(row => row.startsWith('XSRF-TOKEN='))
  return match ? decodeURIComponent(match.split('=')[1]) : ''
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const isMutating =
    method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'

  const headers = new Headers(init.headers)
  if (isMutating) {
    const token = getCsrfToken()
    if (token) headers.set('X-XSRF-TOKEN', token)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: undefined })) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return {} as T
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: { 'X-XSRF-TOKEN': getCsrfToken() },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: undefined })) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  uploadForm: <T>(path: string, form: FormData) => uploadForm<T>(path, form),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
}
