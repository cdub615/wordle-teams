import { useId, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { cn } from '#/lib/utils.ts'
import { MIN_LEAGUE_BOARDS } from '../../../convex/lib/league.ts'
import { fromPuzzleDay, type PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

type Row = { groupId: string; rank: number | null; average: number | null; boards: number; contributors: number }

/** api.leagues.groupStanding's `standing`, structurally: no rank (spec v2 §4.5). */
export type FoundGroup = { group: { name: string }; boards: number; average: number | null }

/**
 * What the route's groupStanding query answered for the submitted `word`:
 * `standing` undefined while it loads, null when the league has no such group;
 * `failed` when the query errored with nothing to show.
 */
export type FindResult = { word: string; standing: FoundGroup | null | undefined; failed?: boolean }

type Props = {
  month: PuzzleMonth
  groups: { _id: string; name: string }[]
  /** A large league passes only its SHOWN rows here, and the viewer's separately. */
  standings: Row[]
  myGroupId: string | null
  lastMonth: { month: PuzzleMonth; winnerGroupId: string | null } | null
  monthsWon: { groupId: string; count: number }[]
  /** Large leagues only: the viewer's row when it is not among the shown ones. */
  viewer?: Row | null
  /** Large leagues only: active groups below the board floor, not listed. */
  unrankedCount?: number
  /** Large leagues only: "Find a group". The route owns the query. */
  find?: { onFind: (word: string) => void; result: FindResult | null }
  className?: string
}

const longMonth = new Intl.DateTimeFormat('en-US', { month: 'long' })

/** 'YYYY-MM' -> 'October'. fromPuzzleDay is local noon, so no timezone rolls it back a month. */
export function monthName(month: PuzzleMonth): string {
  return longMonth.format(fromPuzzleDay(`${month}-01`))
}

/** One standings row: the rank, the group, and its average or its progress to the floor. */
function StandingRow({ row, name, mine }: { row: Row; name: string; mine: boolean }) {
  return (
    <li
      data-testid={`standing-${name}`}
      aria-current={mine ? 'true' : undefined}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2', mine && 'font-semibold')}
    >
      <span className="w-5 text-right tabular-nums text-muted-foreground">{row.rank ?? '–'}</span>
      <span className="font-mono tracking-widest">{name}</span>
      {mine && <span className="text-xs text-muted-foreground">you</span>}
      <span className="ml-auto text-right tabular-nums">
        {row.average === null ? (
          <span className="text-muted-foreground">
            not yet ranked ({row.boards}/{MIN_LEAGUE_BOARDS})
          </span>
        ) : (
          <>
            {row.average.toFixed(1)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {row.boards} boards · {row.contributors} played
            </span>
          </>
        )}
      </span>
    </li>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Keep letters only, at most five, lower-cased: the word as groupStanding's slug. */
const lettersOf = (raw: string) =>
  raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z]/gi, '')
    .slice(0, 5)
    .toLowerCase()

function findText(result: FindResult | null, invalid: boolean): string {
  if (invalid) return 'Enter a five-letter word'
  if (!result) return ''
  const { word, standing } = result
  if (result.failed) return 'Couldn’t search right now. Try again.'
  if (standing === undefined) return 'Searching…'
  if (standing === null) return `No ${word.toUpperCase()} group yet`
  const name = standing.group.name
  if (standing.boards === 0) return `No one plays for ${name} this month`
  if (standing.average === null) return `${name} — not yet ranked (${standing.boards}/${MIN_LEAGUE_BOARDS})`
  return `${name} — ${standing.average.toFixed(1)} · ${plural(standing.boards, 'board', 'boards')}`
}

/**
 * "Find a group" (spec v2 §4.5/§5): any group's live month by its word. ANY
 * FIVE LETTERS are sent: the server answers null both for a word with no group
 * and for a non-answer word, which reads the same to the viewer ("No X group
 * yet"), so the 20 KB answer list is not loaded for this box.
 */
function FindGroup({ onFind, result }: { onFind: (word: string) => void; result: FindResult | null }) {
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)
  const id = useId()
  return (
    <form
      role="search"
      aria-label="Find a group"
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (input.length !== 5) {
          setInvalid(true)
          return
        }
        onFind(input)
      }}
    >
      <Label htmlFor={`${id}-find`}>Find a group</Label>
      <div className="flex gap-2">
        <Input
          id={`${id}-find`}
          value={input}
          onChange={(e) => {
            setInvalid(false)
            setInput(lettersOf(e.target.value))
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-result`}
          className="font-mono uppercase tracking-widest"
        />
        <Button type="submit" variant="outline">
          Find
        </Button>
      </div>
      <p id={`${id}-result`} data-testid="league-find-result" aria-live="polite" className="min-h-5 text-sm">
        {findText(result, invalid)}
      </p>
    </form>
  )
}

/**
 * The standings table (spec §8.2). GROUP TOTALS ONLY: nothing here names a
 * player, and nothing may — strangers see groups, never people (§3.2).
 *
 * A LARGE LEAGUE (spec v2 §4.5) adds, in order: the viewer's row after a
 * separator, the unranked count, and "Find a group".
 */
export function LeagueStandings({ month, groups, standings, myGroupId, lastMonth, monthsWon, viewer, unrankedCount = 0, find, className }: Props) {
  const nameOf = (id: string) => groups.find((g) => g._id === id)?.name ?? ''
  const tally = monthsWon.filter((m) => m.count > 0).sort((a, b) => b.count - a.count)
  const rowOf = (row: Row) => <StandingRow key={row.groupId} row={row} name={nameOf(row.groupId)} mine={row.groupId === myGroupId} />
  return (
    <Card className={className} role="region" aria-label="Standings">
      <CardHeader>
        <CardTitle asChild>
          <h2>{monthName(month)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col divide-y">{standings.map(rowOf)}</ol>
        {/* The viewer's group below the top 10 (spec v2 §4.5): its own list, so
            the ordered list above stays the ranked slice. */}
        {viewer && (
          <>
            <hr className="border-dashed" />
            <ol className="flex flex-col">{rowOf(viewer)}</ol>
          </>
        )}
        {unrankedCount > 0 && (
          <p className="text-sm text-muted-foreground">{`${plural(unrankedCount, 'more group', 'more groups')} not ranked yet`}</p>
        )}
        {lastMonth && (
          <p className="text-sm">
            {lastMonth.winnerGroupId
              ? `${monthName(lastMonth.month)} winner: ${nameOf(lastMonth.winnerGroupId)}`
              : `No winner in ${monthName(lastMonth.month)}`}
          </p>
        )}
        {tally.length > 0 && (
          <p data-testid="league-all-time" className="text-sm text-muted-foreground">
            {`All-time: ${tally.map((m) => `${nameOf(m.groupId)} ${m.count}`).join(' · ')}`}
          </p>
        )}
        {find && <FindGroup onFind={find.onFind} result={find.result} />}
      </CardContent>
    </Card>
  )
}
