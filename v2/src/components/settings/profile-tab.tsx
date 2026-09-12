import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { isCompleteName } from '../../../convex/lib/invite.ts'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { resizeToSquare } from '#/lib/avatar.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { initialsFor } from '#/lib/initials.ts'

/**
 * Identity: the picture and the name, the two things that appear side by side
 * everywhere this app shows a person.
 *
 * THE NAME EDITOR IS NOT PADDING FOR THE TAB. completeProfile is the only other
 * writer of firstName/lastName and it runs exactly once, gated by needsProfile —
 * so before this there was NO way to fix a name typed wrong at signup, and it
 * shows on the scoreboard forever.
 *
 * NO BRAND RING HERE. The rotating gradient in app-menu.tsx is that avatar's
 * decoration; this is a form control and a spinning halo around a file picker
 * would read as a status indicator.
 */
export default function ProfileTab() {
  const { data: me } = useQuery(convexQuery(api.players.myName, {}))
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const generateUploadUrl = useConvexMutation(api.players.generateAvatarUploadUrl)
  const setAvatar = useMutation({ mutationFn: useConvexMutation(api.players.setAvatar) })
  const removeAvatar = useMutation({ mutationFn: useConvexMutation(api.players.removeAvatar) })
  const updateName = useMutation({ mutationFn: useConvexMutation(api.players.updateName) })

  const [firstName, setFirstName] = useState<string | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  // `?? me` rather than seeding state in an effect: the query resolves after
  // first paint, and an effect-seeded field flickers empty on a cold load.
  const first = firstName ?? me?.firstName ?? ''
  const last = lastName ?? me?.lastName ?? ''

  /**
   * Resize, upload, attach. THREE STEPS AND THE MIDDLE ONE IS A PLAIN `fetch` —
   * Convex hands out a one-shot URL and the bytes go straight to it rather than
   * through a mutation argument.
   */
  const onPick = async (file: File) => {
    setUploading(true)
    try {
      const blob = await resizeToSquare(file)
      const url = await generateUploadUrl({})
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      })
      if (!response.ok) throw new Error('Upload failed')
      // Convex's upload endpoint answers `{ storageId }` as JSON; the id
      // itself is an opaque string on the wire and only ever typed as
      // `Id<'_storage'>` again once it is handed back into a Convex call.
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> }
      await setAvatar.mutateAsync({ storageId })
      toast.success('Picture updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not update your picture.'))
    } finally {
      setUploading(false)
      // So picking the SAME file twice fires `change` the second time.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onRemove = async () => {
    try {
      await removeAvatar.mutateAsync({})
      toast.success('Picture removed')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not remove your picture.'))
    }
  }

  const onSaveName = async () => {
    try {
      await updateName.mutateAsync({ firstName: first, lastName: last })
      toast.success('Name updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not update your name.'))
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <h3 className="text-sm font-medium">Picture</h3>
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          {me?.image ? <AvatarImage src={me.image} alt="" aria-hidden="true" /> : null}
          <AvatarFallback className="text-lg font-medium">
            {initialsFor(me?.firstName ?? '', me?.lastName ?? '')}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-testid="avatar-file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onPick(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Change picture
          </Button>
          {/*
            GATED ON `hasUpload`, NOT ON `image`. They are different questions:
            `image` is true for a Google photo too, and removing a provider's
            photo is not something this app can do — offering "Remove picture"
            to a player who never uploaded anything would be a button that does
            nothing.
          */}
          {me?.hasUpload ? (
            <Button
              type="button"
              variant="ghost"
              disabled={removeAvatar.isPending}
              onClick={() => void onRemove()}
            >
              Remove picture
            </Button>
          ) : null}
        </div>
      </div>

      <Separator />

      <h3 className="text-sm font-medium">Name</h3>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-first-name">First name</Label>
        <Input
          id="profile-first-name"
          value={first}
          onChange={(event) => setFirstName(event.target.value)}
        />
        <Label htmlFor="profile-last-name">Last name</Label>
        <Input
          id="profile-last-name"
          value={last}
          onChange={(event) => setLastName(event.target.value)}
        />
        {/*
          DISABLED BY THE SERVER'S OWN PREDICATE, imported rather than restated.
          updateName refuses an empty pair (schema.ts: an empty name reaches the
          scoreboard, the team card and the winner computation), and a form that
          let you press Save into a guaranteed rejection would be a worse way of
          saying the same thing.
        */}
        <Button
          type="button"
          className="self-start"
          disabled={!isCompleteName(first, last) || updateName.isPending}
          onClick={() => void onSaveName()}
        >
          Save name
        </Button>
      </div>
    </div>
  )
}
