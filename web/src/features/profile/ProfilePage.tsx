import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMe, useUploadAvatar } from '@/features/auth/useAuth'

const API_URL = import.meta.env.VITE_API_URL as string

function avatarSrc(avatarUrl: string | null | undefined, username: string, preview: string | null): string {
  if (preview) return preview
  if (avatarUrl) return `${API_URL}${avatarUrl}`
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username)}`
}

export default function ProfilePage() {
  const { data: me } = useMe()
  const { mutate: upload, isPending } = useUploadAvatar()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed')
      return
    }
    setError(null)
    setPreview(URL.createObjectURL(file))
    upload(file, {
      onError: (err) => {
        setPreview(null)
        setError(err instanceof Error ? err.message : 'Upload failed')
      },
    })
  }

  const src = avatarSrc(me?.avatarUrl, me?.username ?? '', preview)

  return (
    <div className="max-w-sm mx-auto mt-16 px-6">
      <h1 className="text-base font-semibold font-mono mb-8">Profile</h1>

      <div className="flex flex-col items-center gap-5">
        {/* Avatar with hover overlay */}
        <button
          type="button"
          className="relative group focus:outline-none"
          onClick={() => fileRef.current?.click()}
          disabled={isPending}
          aria-label="Change avatar"
        >
          <img
            src={src}
            alt={me?.username}
            className="h-24 w-24 rounded-full object-cover border border-border"
          />
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            {isPending
              ? <span className="text-white text-xs font-mono">saving…</span>
              : <Upload className="h-5 w-5 text-white" />
            }
          </div>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
        />

        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={isPending}
        >
          {isPending ? 'Uploading…' : 'Choose photo'}
        </Button>

        {error && (
          <p className="text-xs text-destructive font-mono">{error}</p>
        )}

        <div className="mt-4 text-center">
          <p className="text-sm font-semibold font-mono">{me?.username}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{me?.email}</p>
        </div>
      </div>
    </div>
  )
}
