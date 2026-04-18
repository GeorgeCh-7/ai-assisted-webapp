import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SendHorizonal } from 'lucide-react'

const MAX_BYTES = 3072

type Props = {
  onSend: (content: string, idempotencyKey: string) => void
  disabled?: boolean
}

export default function MessageComposer({ onSend, disabled = false }: Props) {
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)
  // Generated once per logical message; regenerated after each successful submission.
  // On reconnect-triggered resubmit the useSendMessage pending map owns the original key —
  // this state only needs to track the next outbound message.
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const byteLength = new TextEncoder().encode(content).length
  const overLimit = byteLength > MAX_BYTES
  const showCounter = byteLength > MAX_BYTES * 0.75
  const canSend = content.trim().length > 0 && !overLimit && !disabled && !isSending

  const handleSend = () => {
    if (!canSend) return
    const text = content.trim()
    const key = idempotencyKeyRef.current

    setContent('')
    setIsSending(true)
    idempotencyKeyRef.current = crypto.randomUUID() // ready for next message

    // onSend is async internally but we don't await — useSendMessage manages state
    onSend(text, key)
    setIsSending(false)

    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t bg-background px-3 py-2 shrink-0">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            className={`w-full resize-none rounded-md border bg-muted/30 px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${overLimit ? 'border-destructive focus:ring-destructive' : 'border-input'}`}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows={1}
            style={{ minHeight: '2.25rem', maxHeight: '7rem' }}
            value={content}
            onChange={e => {
              setContent(e.target.value)
              // Auto-grow textarea
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
              className={`absolute bottom-1.5 right-2.5 text-[10px] font-mono pointer-events-none ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {byteLength}/{MAX_BYTES}
            </span>
          )}
        </div>

        <Button
          type="button"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
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
  )
}
