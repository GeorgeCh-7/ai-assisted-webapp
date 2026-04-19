import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SendHorizonal } from 'lucide-react'
import ReplyQuoteBanner from './ReplyQuoteBanner'

const MAX_BYTES = 3072

type ReplyCtx = { messageId: string; username: string; content: string }
type EditCtx = { messageId: string; content: string }

type Props = {
  onSend: (content: string, idempotencyKey: string) => void
  onEditSend?: (content: string) => void
  editCtx?: EditCtx | null
  onCancelEdit?: () => void
  replyCtx?: ReplyCtx | null
  onCancelReply?: () => void
  disabled?: boolean
}

export default function MessageComposer({
  onSend,
  onEditSend,
  editCtx,
  onCancelEdit,
  replyCtx,
  onCancelReply,
  disabled = false,
}: Props) {
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // When entering edit mode, prefill the composer with the message being edited
  useEffect(() => {
    if (editCtx) {
      setContent(editCtx.content)
      textareaRef.current?.focus()
    }
  }, [editCtx?.messageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const byteLength = new TextEncoder().encode(content).length
  const overLimit = byteLength > MAX_BYTES
  const showCounter = byteLength > MAX_BYTES * 0.75
  const canSend = content.trim().length > 0 && !overLimit && !disabled && !isSending

  const isEditing = !!editCtx

  const handleSend = () => {
    if (!canSend) return
    const text = content.trim()

    setContent('')
    setIsSending(true)
    resetTextareaHeight()

    if (isEditing && onEditSend) {
      onEditSend(text)
    } else {
      const key = idempotencyKeyRef.current
      idempotencyKeyRef.current = crypto.randomUUID()
      onSend(text, key)
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

      <div className="px-3 py-2">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              className={`w-full resize-none rounded-md border bg-muted/30 px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${
                overLimit ? 'border-destructive focus:ring-destructive' : isEditing ? 'border-amber-400/60' : 'border-input'
              }`}
              placeholder={
                isEditing
                  ? 'Edit message…'
                  : replyCtx
                  ? `Reply to ${replyCtx.username}…`
                  : 'Type a message… (Enter to send, Shift+Enter for newline)'
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
                className={`absolute bottom-1.5 right-2.5 text-[10px] font-mono pointer-events-none ${
                  overLimit ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {byteLength}/{MAX_BYTES}
              </span>
            )}
          </div>

          <Button
            type="button"
            size="icon"
            className={`h-9 w-9 shrink-0 ${isEditing ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
            onClick={handleSend}
            disabled={!canSend}
            aria-label={isEditing ? 'Save edit' : 'Send message'}
          >
            <SendHorizonal className="h-4 w-4" />
          </Button>
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
