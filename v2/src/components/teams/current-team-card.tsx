import { useState } from 'react'
import { LogOut, Mail, Settings, Trash2, UserPlus2 } from 'lucide-react'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { InvitePlayerDialog } from './invite-player-dialog.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

export type TeamMember = { id: string; firstName: string; lastName: string }

/**
 * The selected team's members, and the owner's controls.
 *
 * Ports v1's current-team-client.tsx. Settings, Invite and the per-member
 * remove are owner-only, matching v1's UI; unlike v1 that is now also true of
 * the mutations (divergence 4).
 *
 * TWO THINGS HERE ARE NOT IN v1 AT ALL. The Pending invites list is divergence
 * 6 — v1 shows an owner nowhere who they invited, so a typo'd address sits in
 * `invited[]` forever with no way to see it or take it back. The Leave control
 * is divergence 10 — v1's only exit from a team is asking its owner.
 *
 * ALL members render, including the caller's own row — v1 maps every player
 * and gates only the remove control (`canInvite && player.id !== userId`),
 * never the row itself. The owner has no remove control on their own row:
 * removeMember refuses it server-side, and this gates on `isOwner &&
 * member.id !== myPlayerId` the same way. Filtering `members` itself (an
 * earlier version of this component did, at the call site) instead hid the
 * owner from their own Current Team card, disagreeing with My Teams and the
 * scores table on the same screen.
 */
export function CurrentTeamCard({
  teamId,
  name,
  members,
  isOwner,
  myPlayerId,
  onEditSettings,
  onLeft,
  className,
}: {
  // Id<'teams'>, not string: getMyTeamsFor returns `id: team._id`, so the
  // index.tsx call site already has one. Typing this as `string` was the only
  // reason four mutateAsync calls below had to cast it straight back.
  teamId: Id<'teams'>
  name: string
  members: Array<TeamMember>
  isOwner: boolean
  // Nullable because getMyPlayerId (convex/scores.ts) is: a player record
  // linked purely by email, same as every other access check, and can come
  // back null. `member.id !== myPlayerId` degrades safely when it does —
  // null matches no member, so the gate simply never identifies "your own
  // row", same as before this prop existed.
  myPlayerId: string | null
  onEditSettings: () => void
  // Called after a successful leave, so the caller can deal with `?team=`
  // pointing at a team the user is no longer on — the same broken-param
  // problem MyTeamsCard's onDeleted exists for. No argument: this card only
  // ever renders the SELECTED team, so the team that was left is always the
  // one in the URL, and there is nothing for the caller to compare.
  onLeft: () => void
  className?: string
}) {
  const remove = useMutation({ mutationFn: useConvexMutation(api.teams.removeMember) })
  const cancel = useMutation({ mutationFn: useConvexMutation(api.teams.cancelInvite) })
  const leave = useMutation({ mutationFn: useConvexMutation(api.teams.leaveTeam) })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [openEmail, setOpenEmail] = useState<string | null>(null)
  // One boolean, not a per-row map like `openId` below: Leave renders on at
  // most one row (your own) and only when you are not the owner.
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // Owner-only, and not even SUBSCRIBED TO for anyone else: these are real
  // email addresses, which is why they are not on getMyTeams.
  //
  // `'skip'` RATHER THAN `enabled: isOwner`, and the difference is not
  // stylistic. TanStack Query still adds a disabled query to its cache when the
  // hook mounts, and ConvexQueryClient opens its websocket watch from that
  // cache's `added` event (node_modules/@convex-dev/react-query, subscribeInner)
  // without consulting `enabled` at all — so every non-owner member's browser
  // would subscribe to a query that throws NOT_TEAM_OWNER server-side, and log
  // it. `convexQuery(..., 'skip')` marks the query key skipped, which that same
  // subscriber checks before it watches anything, and sets `enabled: false` for
  // itself.
  //
  // useQuery, not useSuspenseQuery, so a member's card renders without waiting
  // on a read they are never going to make.
  const { data: invites } = useQuery(
    convexQuery(
      api.teams.getTeamInvites,
      isOwner ? { teamId } : 'skip',
    ),
  )

  // EXACT DUPLICATES ARE REACHABLE, so this cannot render `invited` raw. v1's
  // no-account branch appends the address without checking whether it is
  // already parked (`invited.includes(email)` is nested inside its
  // player-exists branch), so re-inviting somebody who never signed up parks the
  // same lowercase string twice; scripts/copy-from-supabase.mjs maps
  // `e.toLowerCase()` over the array and neither trims nor dedupes, so the pair
  // arrives intact. Two identical strings would mean duplicate React keys AND
  // `openEmail === email` matching both rows, so one click would open two
  // popovers.
  //
  // Deduplicating hides nothing the owner could act on: the rows are
  // character-for-character identical, and cancelInvite removes EVERY matching
  // entry anyway, so one row really is one cancellable address.
  //
  // WHAT THIS DOES NOT FIX, stated because it is easy to assume otherwise:
  // entries that merely NORMALISE to each other still render as two rows, and
  // those two rows are indistinguishable. Neither copy gate trims, so ' a@b.c'
  // and 'a@b.c' both survive as distinct strings — but HTML collapses the
  // leading space, so measured in this exact markup both spans have innerText
  // 'a@b.c' and width 48px, and both aria-labels read the same. Then
  // cancelInviteFor normalises before it filters, so cancelling either one
  // deletes BOTH: the list drops by two for a single click, with a toast naming
  // one address. Rare (it needs a padded row copied from v1) and it errs
  // towards clearing junk rather than leaving it, so it is recorded rather than
  // worked around — a fix belongs in the copy gate, not here.
  const pendingInvites = invites ? Array.from(new Set(invites)) : []

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
        teamId,
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

  const handleCancel = async (email: string) => {
    setPendingEmail(email)
    try {
      await cancel.mutateAsync({ teamId, email })
      toast.success(`Invite to ${email} cancelled`)
      setOpenEmail(null)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not cancel that invite'))
    } finally {
      setPendingEmail(null)
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await leave.mutateAsync({ teamId, today: toPuzzleDay(new Date()) })
      toast.success(`You left ${name}`)
      setLeaveOpen(false)
      onLeft()
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not leave that team'))
    } finally {
      setLeaving(false)
    }
  }

  return (
    // role="region" + aria-label give this card a landmark distinct from
    // MyTeamsCard's "My Teams" — both list team names/members, and the
    // selected team's own name is also a heading here, so without this a
    // test (or a screen-reader user) has no reliable way to scope "the
    // Current Team card" apart from "any card mentioning this team". Same
    // pattern as board-input.tsx's `role="region" aria-label="Wordle Board"`.
    <Card className={className} role="region" aria-label="Current Team">
      <CardHeader>
        <CardTitle asChild>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h2 className="min-w-0 truncate">{name}</h2>
            {isOwner && (
              <div className="flex shrink-0 gap-2">
                <Button size="icon" variant="outline" aria-label="Team settings" onClick={onEditSettings}>
                  <Settings size={22} />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Invite player"
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus2 size={22} />
                </Button>
              </div>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col space-y-2">
          {members.map((member, index) => (
            <li key={member.id} className="min-w-0">
              <div className="flex w-full min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {member.firstName} {member.lastName}
                </span>
                {isOwner && member.id !== myPlayerId && (
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
                {/* Leave is the exact COMPLEMENT of remove above, and the two
                    must never both render on one row. getMyTeamsFor computes
                    `isOwner` as `team.owner === playerId`, the same
                    comparison leaveTeamFor makes before it throws
                    OWNER_NOT_REMOVABLE, so gating on `!isOwner` means that
                    error is unreachable from this control while the server
                    still refuses an owner who asks for it directly. An owner
                    sees remove on everyone else's row and nothing on their own;
                    a member sees Leave on their own row and nothing on anyone
                    else's.

                    THE TWO GATES DEGRADE IN OPPOSITE DIRECTIONS when
                    myPlayerId is null (see the prop's comment). `member.id ===
                    myPlayerId` matches nothing, so a member gets no Leave
                    control at all — nothing offered, nothing broken. Remove's
                    `member.id !== myPlayerId` matches EVERYTHING, so an owner
                    gets an extra Remove on their own row that removeMemberFor
                    always refuses with OWNER_NOT_REMOVABLE. That is Phase 3
                    behaviour and is left alone here; it is recorded only so
                    nobody reads these two lines as symmetric. */}
                {!isOwner && member.id === myPlayerId && (
                  <ConfirmPopover
                    open={leaveOpen}
                    onOpenChange={setLeaveOpen}
                    trigger={
                      <Button variant="ghost" aria-label={`Leave ${name}`}>
                        <LogOut size={16} className="text-danger" />
                      </Button>
                    }
                    message={`Leave ${name}?`}
                    confirmLabel="Leave"
                    pending={leaving}
                    onConfirm={handleLeave}
                  />
                )}
              </div>
              {index < members.length - 1 && <Separator className="mt-2" />}
            </li>
          ))}
        </ul>
        {isOwner && pendingInvites.length > 0 && (
          <div className="mt-4">
            <Separator className="mb-4" />
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Pending invites</h3>
            <ul className="flex flex-col space-y-2">
              {pendingInvites.map((email) => (
                <li key={email} className="min-w-0">
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    {/* WRAPS, where the member rows above truncate, and the
                        difference is the whole point of this section. A member
                        row shows a short name; a pending row shows an address,
                        and divergence 6 exists so an owner can "tell a typo
                        from a slow responder". Typos live in the TAIL —
                        @gmial.com, exampl3.com — which is exactly what an
                        ellipsis eats: at 390px the truncated box fit 31
                        characters, so three addresses differing only in domain
                        rendered pixel-identical. break-all rather than plain
                        wrapping because an address has no spaces to break at. */}
                    <span className="text-muted-foreground flex min-w-0 items-start gap-2">
                      {/* items-start + mt-[5px], not items-center: once an
                          address wraps, centring puts the envelope on line 2 of
                          3 — measured 24px, exactly one line box, below the
                          first line's midpoint. It is the only row-start marker
                          in a section that exists to be SCANNED, so a marker
                          pointing at the middle works against the wrap beside
                          it. 5px is (24 - 14) / 2, the icon's optical centre on
                          a 24px line box. The trash button stays centred on the
                          outer flex — that reads as a row-level action. */}
                      <Mail size={14} className="mt-[5px] shrink-0" />
                      <span className="min-w-0 break-all">{email}</span>
                    </span>
                    <ConfirmPopover
                      open={openEmail === email}
                      onOpenChange={(next) => setOpenEmail(next ? email : null)}
                      trigger={
                        <Button variant="ghost" aria-label={`Cancel invite to ${email}`}>
                          <Trash2 size={16} className="text-danger" />
                        </Button>
                      }
                      message={`Cancel the invite to ${email}?`}
                      confirmLabel="Cancel invite"
                      pending={pendingEmail === email}
                      onConfirm={() => handleCancel(email)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {/* The only thing that can set `inviteOpen` is the owner-only button
          above, so for everyone else this would mount a dialog with no trigger —
          and with it useVisualViewport's resize/scroll listeners — that can
          never open. */}
      {isOwner && (
        <InvitePlayerDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          teamId={teamId}
          teamName={name}
        />
      )}
    </Card>
  )
}
