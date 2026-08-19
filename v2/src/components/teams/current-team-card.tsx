import { useState } from 'react'
import { Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

export type TeamMember = { id: string; firstName: string; lastName: string }

/**
 * The selected team's members, and the creator's controls.
 *
 * Ports v1's current-team-client.tsx, minus the Invite button — invites are
 * Phase 4. Settings and the per-member remove are creator-only, matching v1's
 * UI; unlike v1 that is now also true of the mutation (divergence 4).
 *
 * The creator has no remove control on their own row: removeMember refuses it
 * server-side, and v1 hides it the same way.
 */
export function CurrentTeamCard({
  teamId,
  name,
  members,
  isCreator,
  onEditSettings,
  className,
}: {
  teamId: string
  name: string
  members: Array<TeamMember>
  isCreator: boolean
  onEditSettings: () => void
  className?: string
}) {
  const remove = useMutation({ mutationFn: useConvexMutation(api.teams.removeMember) })
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Which member's popover is open, if any. Controlled so a successful remove
  // can close it explicitly (see handleRemove below) instead of relying on
  // the member's <li> unmounting once the Convex subscription re-pushes the
  // team without them — that unmount is a second, independent async hop, and
  // in the gap the popover would otherwise sit open over a member the server
  // already removed.
  const [openId, setOpenId] = useState<string | null>(null)

  const handleRemove = async (playerId: string) => {
    setPendingId(playerId)
    try {
      await remove.mutateAsync({
        teamId: teamId as Id<'teams'>,
        playerId: playerId as Id<'players'>,
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully removed player')
      setOpenId(null)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to remove player'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle asChild>
          <div className="flex items-center justify-between">
            <h2>{name}</h2>
            {isCreator && (
              <Button size="icon" variant="outline" aria-label="Team settings" onClick={onEditSettings}>
                <Settings size={22} />
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col space-y-2">
          {members.map((member, index) => (
            <li key={member.id}>
              <div className="flex w-full items-center justify-between">
                <span>
                  {member.firstName} {member.lastName}
                </span>
                {isCreator && (
                  <ConfirmPopover
                    open={openId === member.id}
                    onOpenChange={(next) => setOpenId(next ? member.id : null)}
                    trigger={
                      <Button variant="ghost" aria-label={`Remove ${member.firstName}`}>
                        <Trash2 size={16} className="text-danger" />
                      </Button>
                    }
                    message={`Remove player from ${name}?`}
                    confirmLabel="Remove"
                    pending={pendingId === member.id}
                    onConfirm={() => handleRemove(member.id)}
                  />
                )}
              </div>
              {index < members.length - 1 && <Separator className="mt-2" />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
