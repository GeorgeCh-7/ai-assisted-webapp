import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useCreateRoom } from './useRooms'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  description: z.string().max(200, 'Description too long'),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CreateRoomModal = ({ open, onOpenChange }: Props) => {
  const navigate = useNavigate()
  const [isPrivate, setIsPrivate] = useState(false)
  const { mutate: createRoom, isPending, error, reset: resetMutation } = useCreateRoom()

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  })

  useEffect(() => {
    if (!open) {
      resetForm()
      resetMutation()
      setIsPrivate(false)
    }
  }, [open, resetForm, resetMutation])

  const onSubmit = (values: FormValues) => {
    createRoom({ ...values, isPrivate }, {
      onSuccess: room => {
        onOpenChange(false)
        navigate(`/rooms/${room.id}`)
      },
    })
  }

  const serverError =
    error instanceof ApiError ? error.message : error ? 'Something went wrong' : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Create room</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium font-mono" htmlFor="room-name">
              <span className="text-emerald-600 dark:text-emerald-400">#</span> name
            </label>
            <Input
              id="room-name"
              placeholder="e.g. general"
              className="font-mono"
              autoComplete="off"
              disabled={isPending}
              {...register('name')}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="room-desc">
              Description{' '}
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              id="room-desc"
              placeholder="What's this room about?"
              disabled={isPending}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="is-private"
              checked={isPrivate}
              onCheckedChange={checked => setIsPrivate(checked === true)}
              disabled={isPending}
            />
            <Label htmlFor="is-private" className="text-sm font-medium cursor-pointer leading-none">
              Private room
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                invite-only, not listed in catalog
              </span>
            </Label>
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create room'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CreateRoomModal
