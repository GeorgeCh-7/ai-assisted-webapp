import { useState } from 'react'
import { ApiError } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL

type UploadedFile = {
  id: string
  originalFilename: string
  contentType: string
  sizeBytes: number
}

type UploadContext = {
  scope: 'room' | 'dm'
  scopeId: string
}

function getCsrfToken(): string {
  const match = document.cookie
    .split('; ')
    .find(row => row.startsWith('XSRF-TOKEN='))
  return match ? decodeURIComponent(match.split('=')[1]) : ''
}

export function useFileUpload(context: UploadContext) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File): Promise<UploadedFile | null> => {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('scope', context.scope)
      form.append('scopeId', context.scopeId)

      const res = await fetch(`${API_URL}/api/files`, {
        method: 'POST',
        headers: { 'X-XSRF-TOKEN': getCsrfToken() },
        credentials: 'include',
        body: form,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: undefined })) as { error?: string }
        throw new ApiError(res.status, body.error ?? `Upload failed (${res.status})`)
      }

      return await res.json() as UploadedFile
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Upload failed'
      setError(msg)
      return null
    } finally {
      setUploading(false)
    }
  }

  return { upload, uploading, error }
}
