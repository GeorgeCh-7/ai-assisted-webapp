import { useEffect, useRef, useState } from 'react'
import { SendHorizonal, Paperclip, X } from 'lucide-react'
import ReplyQuoteBanner from './ReplyQuoteBanner'
import { useFileUpload } from '@/features/files/useFileUpload'

const MAX_BYTES = 3072

type ReplyCtx = { messageId: string; username: string; content: string }
type EditCtx = { messageId: string; content: string }

type UploadContext = { scope: 'room' | 'dm'; scopeId: string }

type Props = {
  onSend: (content: string, idempotencyKey: string, attachmentFileIds: string[]) => void
  onEditSend?: (content: string) => void
  editCtx?: EditCtx | null
  onCancelEdit?: () => void
  replyCtx?: ReplyCtx | null
  onCancelReply?: () => void
  disabled?: boolean
  uploadContext?: UploadContext
}

export default function MessageComposer({
  onSend,
  onEditSend,
  editCtx,
  onCancelEdit,
  replyCtx,
  onCancelReply,
  disabled = false,
  uploadContext,
}: Props) {
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<Array<{ id: string; name: string }>>([])
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { upload, uploading } = useFileUpload(uploadContext ?? { scope: 'room', scopeId: '' })

  // When entering edit mode, prefill the composer with the message being edited
  useEffect(() => {
    if (editCtx) {
      setContent(editCtx.content)
      textareaRef.current?.focus()
    }
  }, [editCtx?.messageId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Autofocus when reply context is set — double-RAF ensures banner has rendered before we focus
  useEffect(() => {
    if (!replyCtx) return
    let raf2: number
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => textareaRef.current?.focus())
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [replyCtx?.messageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const byteLength = new TextEncoder().encode(content).length
  const overLimit = byteLength > MAX_BYTES
  const showCounter = byteLength > MAX_BYTES * 0.75
  const canSend = (content.trim().length > 0 || pendingFiles.length > 0) && !overLimit && !disabled && !isSending && !uploading

  const isEditing = !!editCtx

  const handleFileSelected = async (file: File) => {
    if (!uploadContext) return
    const result = await upload(file)
    if (result) {
      setPendingFiles(prev => [...prev, { id: result.id, name: result.originalFilename }])
    }
  }

  const handleSend = () => {
    if (!canSend) return
    const text = content.trim()
    const fileIds = pendingFiles.map(f => f.id)

    setContent('')
    setPendingFiles([])
    setIsSending(true)
    resetTextareaHeight()

    if (isEditing && onEditSend) {
      onEditSend(text)
    } else {
      const key = idempotencyKeyRef.current
      idempotencyKeyRef.current = crypto.randomUUID()
      onSend(text, key, fileIds)
    }

    setIsSending(false)
    textareaRef.current?.focus()
  }

  const handleCancel = () => {
    setContent('')
    resetTextareaHeight()
    if (isEditing) onCancelEdit?.()
    else onCancelReply?.()
  }

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      if (isEditing || replyCtx) handleCancel()
    }
  }

  return (
    <div className="border-t bg-background shrink-0">
      {/* Reply banner */}
      {replyCtx && !isEditing && (
        <ReplyQuoteBanner
          replyToUsername={replyCtx.username}
          replyToContent={replyCtx.content}
          onDismiss={() => onCancelReply?.()}
        />
      )}

      {/* Edit mode indicator */}
      {isEditing && (
        <div className="px-3 py-1 border-t bg-amber-500/10 text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center justify-between">
          <span>Editing message — Esc or Cancel to discard</span>
          <button
            className="text-muted-foreground hover:text-foreground underline text-[11px]"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Pending file attachments */}
      {pendingFiles.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-1.5">
          {pendingFiles.map(f => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 text-[11px] font-mono bg-muted/50 border rounded px-1.5 py-0.5 max-w-[180px]"
            >
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => setPendingFiles(prev => prev.filter(p => p.id !== f.id))}
                aria-label="Remove attachment"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="px-3 py-2">
        {/* Single bordered container — textarea + action icons inside, like Teams */}
        <div className={`flex items-center rounded-md border bg-muted/30 focus-within:ring-1 focus-within:ring-ring ${
          overLimit ? 'border-destructive focus-within:ring-destructive' : isEditing ? 'border-amber-400/60' : 'border-input'
        }`}>
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              className="w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
              placeholder={
                isEditing
                  ? 'Edit message…'
                  : replyCtx
                  ? `Reply to ${replyCtx.username}…`
                  : 'Message…'
              }
              rows={1}
              style={{ minHeight: '2.25rem', maxHeight: '7rem' }}
              value={content}
              onChange={e => {
                setContent(e.target.value)
                const el = e.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 112)}px`
              }}
              onKeyDown={handleKeyDown}
              disabled={disabled || isSending}
              autoComplete="off"
              spellCheck
            />
            {showCounter && (
              <span
                className={`absolute bottom-1.5 right-2 text-[10px] font-mono pointer-events-none ${
                  overLimit ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {byteLength}/{MAX_BYTES}
              </span>
            )}
          </div>

          {uploadContext && !isEditing && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelected(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded-sm m-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </>
          )}

          <button
            type="button"
            className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-sm m-0.5 transition-colors disabled:opacity-40 ${
              isEditing
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : canSend
                ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={handleSend}
            disabled={!canSend}
            aria-label={isEditing ? 'Save edit' : 'Send message'}
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>

        {overLimit && (
          <p className="mt-1 text-[11px] text-destructive font-mono">
            Message too long — max 3 KB ({MAX_BYTES} bytes UTF-8)
          </p>
        )}
      </div>
    </div>
  )
}
