import { FileDown, ImageIcon } from 'lucide-react'
import type { FileAttachmentDto } from '@/features/chat/types'

const API_URL = import.meta.env.VITE_API_URL

type Props = {
  attachment: FileAttachmentDto
}

export default function FileAttachmentView({ attachment }: Props) {
  const src = `${API_URL}/api/files/${attachment.id}`
  const isImage = attachment.contentType.startsWith('image/')

  if (isImage) {
    return (
      <div className="mt-1 max-w-xs">
        <img
          src={src}
          alt={attachment.originalFilename}
          className="rounded border max-h-64 object-contain bg-muted/20"
          onError={e => {
            const el = e.currentTarget
            el.style.display = 'none'
            el.nextElementSibling?.classList.remove('hidden')
          }}
        />
        <div className="hidden mt-1">
          <FallbackLink attachment={attachment} src={src} />
        </div>
      </div>
    )
  }

  return <FallbackLink attachment={attachment} src={src} />
}

function FallbackLink({ attachment, src }: { attachment: FileAttachmentDto; src: string }) {
  return (
    <a
      href={src}
      download={attachment.originalFilename}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 mt-1 text-[11px] font-mono text-sky-600 dark:text-sky-400 hover:underline"
    >
      {attachment.contentType.startsWith('image/') ? (
        <ImageIcon className="h-3 w-3 shrink-0" />
      ) : (
        <FileDown className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate max-w-[200px]">{attachment.originalFilename}</span>
      <span className="text-muted-foreground/60">
        ({Math.round(attachment.sizeBytes / 1024)} KB)
      </span>
    </a>
  )
}
