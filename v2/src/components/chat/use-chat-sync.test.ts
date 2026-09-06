import { describe, expect, it } from 'vitest'
import {
  anchoredScrollTop,
  AT_TOP_SLACK_PX,
  beforeForOlder,
  chatDayIndex,
  chatEntryLabel,
  chatHeading,
  hasUnread,
  hasUnreadElsewhere,
  isAtTop,
  isCurrentRequest,
  isNearBottom,
  mergeOlder,
  messageRows,
  NEAR_BOTTOM_SLACK_PX,
  nextOlderOutcome,
  nextSinceOutcome,
  nextSyncAction,
  RUN_GAP_MS,
  SEPARATOR_GAP_MS,
  separatorBefore,
  separatorLabel,
  shouldShowLoadOlder,
  showsAuthorName,
  startsRun,
  teamPickerLabel,
  unreadTeamIds,
} from './use-chat-sync.ts'
import type { ChatMessage, ScrollPosition } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'
import { RECENT_WINDOW } from '../../../convex/lib/chatLimits.ts'

const at = (lastMessageAt: number, revision: number) => ({ lastMessageAt, revision, degraded: false })

describe('nextSyncAction', () => {
  it('loads the window when we hold nothing', () => {
    expect(nextSyncAction(null, at(500, 3), 0)).toEqual({ kind: 'window' })
  })

  it('does nothing when the pointer has not moved', () => {
    expect(nextSyncAction(at(500, 3), at(500, 3), 500)).toEqual({ kind: 'none' })
  })

  // The ordinary case: a new message arrived, so fetch only what we lack.
  it('appends from our newest when lastMessageAt advances', () => {
    expect(nextSyncAction(at(500, 3), at(600, 4), 500)).toEqual({ kind: 'since', since: 500 })
  })

  // A DELETE looks like this: history changed, but the newest message did not
  // move. We cannot know WHICH message went, so the window is refetched.
  it('refetches the window when revision moves alone', () => {
    expect(nextSyncAction(at(500, 3), at(500, 4), 500)).toEqual({ kind: 'window' })
  })

  // Both moved: a send and a delete coalesced into one delivered update. The
  // append would miss the deletion, so the window wins.
  it('prefers the window when both moved by more than one revision', () => {
    expect(nextSyncAction(at(500, 3), at(600, 5), 500)).toEqual({ kind: 'window' })
  })
})

describe('isCurrentRequest', () => {
  it('is current when nothing has dispatched since', () => {
    expect(isCurrentRequest(1, 1)).toBe(true)
  })

  // The ordinary race this guards against: a fetch dispatched as #1 is still
  // resolving when the pointer fires again and dispatches #2. #1's answer, if
  // applied, would overwrite whatever #2 goes on to set.
  it('is stale once a later request has dispatched', () => {
    expect(isCurrentRequest(1, 2)).toBe(false)
  })

  // Not merely "not equal": an id from the future never wins either, which is
  // what keeps this a plain equality check rather than mine >= latest.
  it('is stale when checked against an id from before it was dispatched', () => {
    expect(isCurrentRequest(2, 1)).toBe(false)
  })
})

describe('nextSinceOutcome', () => {
  const message = (createdAt: number): ChatMessage => ({
    _id: `msg_${createdAt}` as Id<'chatMessages'>,
    playerId: 'player_1' as Id<'players'>,
    body: 'hi',
    createdAt,
  })

  it('appends the fetched messages onto what is held', () => {
    const held = [message(100)]
    expect(nextSinceOutcome(held, { gap: false, messages: [message(200)] })).toEqual({
      kind: 'messages',
      messages: [message(100), message(200)],
    })
  })

  it('refetches the window on a gap', () => {
    expect(nextSinceOutcome([message(100)], { gap: true })).toEqual({ kind: 'window' })
  })

  // Not merely equal contents — the SAME array reference, which is what lets
  // setMessages bail out of the re-render via React's Object.is check instead
  // of committing a fresh array with nothing new in it.
  it('is a no-op, by reference, when nothing new came back', () => {
    const held = [message(100)]
    const outcome = nextSinceOutcome(held, { gap: false, messages: [] })
    expect(outcome).toEqual({ kind: 'messages', messages: held })
    expect(outcome.kind === 'messages' && outcome.messages).toBe(held)
  })
})

// Scrollback's three pure decisions. Shared helper rather than three copies of
// the one inside `nextSinceOutcome` above; `body` doubles as an identity label
// in the assertions, which is why it varies here and does not there.
const older = (createdAt: number, body = `m${createdAt}`): ChatMessage => ({
  _id: `msg_${createdAt}` as Id<'chatMessages'>,
  playerId: 'player_1' as Id<'players'>,
  body,
  createdAt,
})

describe('beforeForOlder', () => {
  // NOT 0, and not "just fire it anyway". `olderMessages` is a metered,
  // rate-limited mutation: a request that can only come back empty still
  // spends one of the ten pages a minute the caller gets.
  it('has nothing to page from when nothing is held', () => {
    expect(beforeForOlder([])).toBeNull()
  })

  // The OLDEST held, not the newest: the server takes messages strictly
  // before this timestamp, so anything else re-reads a page we already have.
  it('pages from the oldest held message', () => {
    expect(beforeForOlder([older(100), older(200), older(300)])).toBe(100)
  })
})

describe('nextOlderOutcome', () => {
  it('puts a fetched page ahead of the pages already held', () => {
    expect(nextOlderOutcome([older(300)], [older(100), older(200)])).toEqual({
      kind: 'pages',
      pages: [older(100), older(200), older(300)],
    })
  })

  // History only ever grows NEWER, so an empty page is proof there is nothing
  // before this point — permanently, not just now. That is what lets the
  // route retire the button rather than leave it there to spend rate-limit
  // budget on a question already answered.
  it('reports the start of history when a page comes back empty', () => {
    expect(nextOlderOutcome([older(300)], [])).toEqual({ kind: 'start' })
  })

  it('stays oldest-first across successive pages', () => {
    const first = nextOlderOutcome([], [older(300)])
    const pages = first.kind === 'pages' ? first.pages : []
    expect(nextOlderOutcome(pages, [older(100), older(200)])).toEqual({
      kind: 'pages',
      pages: [older(100), older(200), older(300)],
    })
  })
})

describe('mergeOlder', () => {
  it('renders held pages ahead of the live window', () => {
    expect(mergeOlder([older(100)], [older(200)])).toEqual([older(100), older(200)])
  })

  // THE DUPLICATE-KEY BUG THIS EXISTS TO PREVENT. The live window is the
  // newest RECENT_WINDOW messages, refetched whole on every delete — so
  // deleting a recent message pulls one older message INTO the window, and
  // that message may already be sitting in a page scrollback fetched earlier.
  // Rendered as-is that is the same `_id` twice in one <ol>. The live copy
  // wins because it is the one the pointer keeps current.
  it('drops an older copy of a message the live window has since taken in', () => {
    const shown = mergeOlder([older(100), older(200)], [older(200, 'live'), older(300)])
    expect(shown).toEqual([older(100), older(200, 'live'), older(300)])
  })

  // The same Object.is bail-out `nextSinceOutcome` protects: before anyone
  // presses "load older" this runs on every single render of the list.
  it('is the live window itself, by reference, when no page is held', () => {
    const live = [older(200)]
    expect(mergeOlder([], live)).toBe(live)
  })
})

/**
 * THE ARGUMENT THAT REPLACED A FULL `teams` SCAN (wordle-teams-w7g2), and the
 * single thing standing between the badge and TWO Convex subscriptions.
 *
 * `unreadTeams` used to take no arguments, so every caller of it — the
 * dashboard, the picker's trigger, each row badge — hashed to one TanStack
 * query key for free. Now that it takes ids, the key IS the ids, and two
 * callers that build the same set in a different order get two cache entries,
 * two subscriptions and two server executions for one answer. Sorting is what
 * makes the key a function of the SET rather than of the order somebody
 * happened to render in.
 */
describe('unreadTeamIds', () => {
  const alpha = 'team_alpha'
  const beta = 'team_beta'
  const gamma = 'team_gamma'

  it('is the ids, in an order that does not depend on the caller', () => {
    expect(unreadTeamIds([{ id: gamma }, { id: alpha }, { id: beta }])).toEqual([
      alpha,
      beta,
      gamma,
    ])
  })

  // THE PROPERTY THE SINGLE SUBSCRIPTION RESTS ON, stated directly rather than
  // implied by the case above: the same teams in any order are the same key.
  it('is the same array for the same teams however they arrive', () => {
    expect(unreadTeamIds([{ id: beta }, { id: alpha }])).toEqual(
      unreadTeamIds([{ id: alpha }, { id: beta }]),
    )
  })

  it('does not reorder the caller\'s own list', () => {
    // TeamPicker renders `teams` in createdAt order and the menu must keep it.
    // `.sort()` mutates in place, so building the ids without copying first
    // would silently re-sort the picker alphabetically.
    const teams = [{ id: gamma }, { id: alpha }]
    unreadTeamIds(teams)
    expect(teams).toEqual([{ id: gamma }, { id: alpha }])
  })

  /**
   * `undefined` IN, `undefined` OUT, WHICH IS NOT THE SAME AS `[]`.
   *
   * An unresolved TEAMS list is not an empty one. Collapsing it to `[]` would
   * send a real query asking about no teams, get a real `[]` back, and
   * `hasUnread` would then read that as the settled answer "nothing unread" —
   * the badge asserting something it has not been told. `undefined` keeps the
   * query skipped and leaves `hasUnread` in its own not-loaded branch.
   */
  it('stays unresolved while the teams list is', () => {
    expect(unreadTeamIds(undefined)).toBeUndefined()
  })

  it('is empty for someone with no teams, which IS an answer', () => {
    expect(unreadTeamIds([])).toEqual([])
  })
})

describe('hasUnread', () => {
  const alpha = 'team_alpha' as Id<'teams'>
  const beta = 'team_beta' as Id<'teams'>

  it('shows a dot for a team in the unread list', () => {
    expect(hasUnread([alpha, beta], alpha)).toBe(true)
  })

  it('shows no dot for a team that is not in it', () => {
    expect(hasUnread([beta], alpha)).toBe(false)
  })

  // THE "NOT LOADED YET" BRANCH, and the reason this is a function rather than
  // an inline `.includes`. `undefined` is TanStack's pre-resolution state, not
  // an answer; `[]` is the real "nothing unread". Reading the unknown state as
  // unread would flash a dot on every team on every page load.
  it('shows no dot while the query has not resolved', () => {
    expect(hasUnread(undefined, alpha)).toBe(false)
  })

  it('shows no dot when nothing at all is unread', () => {
    expect(hasUnread([], alpha)).toBe(false)
  })
})
/**
 * The dashboard's "Team chat" control names its own unread state, because the
 * dot inside it cannot: `aria-label` replaces an element's content in the
 * accessibility tree, `UnreadBadge`'s `role="img"` label included.
 */
describe('chatEntryLabel', () => {
  it('names the unread state, since the badge inside the button is not read out', () => {
    expect(chatEntryLabel(true)).toBe('Team chat, unread messages')
  })

  it('is the plain control name when there is nothing unread', () => {
    expect(chatEntryLabel(false)).toBe('Team chat')
  })

  // THE PAIR IS THE POINT, not either string on its own: a constant label —
  // which is what this control had before wordle-teams-qix.25, and what every
  // other icon-collapsing button in the app correctly has — passes lint,
  // typecheck, build and every rendering test, and silently takes the badge
  // away from anyone not looking at the screen.
  it('says something different in the two states', () => {
    expect(chatEntryLabel(true)).not.toBe(chatEntryLabel(false))
  })
})
/**
 * THE TRIGGER DOT'S WHOLE QUESTION, and it is not the same one `hasUnread`
 * answers. Radix unmounts TeamPicker's menu content when the menu is closed, so
 * the per-team dots do not exist at rest; this is what decides whether the
 * closed trigger says anything at all.
 */
describe('hasUnreadElsewhere', () => {
  const alpha = 'team_alpha' as Id<'teams'>
  const beta = 'team_beta' as Id<'teams'>
  const gamma = 'team_gamma' as Id<'teams'>

  it('lights up when a team other than the selected one is unread', () => {
    expect(hasUnreadElsewhere([beta], alpha)).toBe(true)
  })

  it('stays dark when the ONLY unread team is the one already on screen', () => {
    // THE CASE THE WHOLE FUNCTION EXISTS FOR. The dashboard's "Team chat"
    // button beside the picker already shows this team's unread, so a trigger
    // dot here would draw two dots for one fact — and would sit lit while the
    // reader is inside that very conversation, which is how a signal gets
    // trained out of someone.
    expect(hasUnreadElsewhere([alpha], alpha)).toBe(false)
  })

  it('lights up when the selected team is unread AND another one is too', () => {
    expect(hasUnreadElsewhere([alpha, beta], alpha)).toBe(true)
  })

  it('counts every unread team as an "other" when nothing is selected', () => {
    // A real state, not a defensive one: routes/app.tsx renders TeamPicker for
    // the renders before useDashboardSearchSync fills `?team=` in, and a stale
    // param can name a team the player has left.
    expect(hasUnreadElsewhere([alpha, beta], undefined)).toBe(true)
  })

  // THE LOADED CHECK, INHERITED FROM `hasUnread` RATHER THAN REWRITTEN. Both
  // "not resolved yet" and "resolved to nothing" must draw no dot, and only one
  // of those two is an answer.
  it('draws nothing while the query has not resolved', () => {
    expect(hasUnreadElsewhere(undefined, alpha)).toBe(false)
  })

  it('draws nothing while the query has not resolved and nothing is selected', () => {
    expect(hasUnreadElsewhere(undefined, undefined)).toBe(false)
  })

  it('draws nothing when no team at all is unread', () => {
    expect(hasUnreadElsewhere([], alpha)).toBe(false)
  })

  it('is unmoved by which of the others is unread', () => {
    expect(hasUnreadElsewhere([gamma], alpha)).toBe(true)
  })
})

/**
 * The trigger's accessible name, which has to carry the roll-up dot's meaning
 * because `aria-label` replaces the content the dot lives in.
 */
describe('teamPickerLabel', () => {
  it('is byte-for-byte the old name when nothing else is unread', () => {
    // TWO E2E SPECS LOCATE THIS TRIGGER BY ITS EXACT ACCESSIBLE NAME
    // (teams.spec.ts, billing.spec.ts) and Playwright matches the whole
    // string. Their seeds post no chat messages, so this is the branch they
    // run — pinned here so a change to it is a named failure in a suite CI
    // runs, rather than a surprise in one it does not.
    expect(teamPickerLabel('E2E Team', false)).toBe('Team: E2E Team')
  })

  it('says the unread is somewhere ELSE, never about the team it names', () => {
    // "Team: Alpha, unread messages" would read as a claim about Alpha — the
    // one team the dot is guaranteed NOT to be about.
    expect(teamPickerLabel('Alpha', true)).toBe('Team: Alpha, other teams have unread messages')
  })

  it('keeps the FULL name in both states, never the truncated one', () => {
    // team-picker.tsx paints `Some very long...` on the button and passes the
    // whole name here; truncation is a visual affordance, not something a
    // screen-reader user should have to sit through.
    const long = 'Some very long team name'
    expect(teamPickerLabel(long, true)).toContain(long)
    expect(teamPickerLabel(long, false)).toContain(long)
  })
})
/**
 * The chat page's heading, which until now did not exist: /chat rendered a
 * message list and a composer and never said whose conversation it was.
 */
describe('chatHeading', () => {
  const alpha = 'team_alpha' as Id<'teams'>
  const beta = 'team_beta' as Id<'teams'>
  const teams = [
    { id: 'team_alpha', name: 'White Famiglia' },
    { id: 'team_beta', name: 'Wordle Wizards' },
  ]

  it('names the team once getMyTeams has answered', () => {
    expect(chatHeading(teams, alpha)).toEqual({ kind: 'named', name: 'White Famiglia' })
  })

  it('picks the team in the URL, not the first one the player is on', () => {
    // The push notification that lands someone here names a SPECIFIC team, and
    // the whole point of the heading is confirming which conversation opened.
    expect(chatHeading(teams, beta)).toEqual({ kind: 'named', name: 'Wordle Wizards' })
  })

  // THE DISTINCTION THE WHOLE TYPE EXISTS FOR, and the same one `hasUnread`
  // draws: `undefined` is TanStack's pre-resolution state, not an answer.
  // Rendering a name from it is impossible, but rendering the OTHER state's
  // answer — a permanent generic title — would be wrong in the opposite
  // direction, since the name is about to arrive.
  it('is pending while getMyTeams has not resolved', () => {
    expect(chatHeading(undefined, alpha)).toEqual({ kind: 'pending' })
  })

  it('is unnamed for a team the player is not on, which is the outsider case', () => {
    // e2e/chat.spec.ts drives exactly this: a signed-in account opening
    // /chat?team=<someone else's team>. It asserts nothing of that
    // conversation leaks — the NAME included, which is why this is not
    // "pending" and not a name.
    expect(chatHeading(teams, 'team_gamma' as Id<'teams'>)).toEqual({ kind: 'unnamed' })
  })

  it('is unnamed, not pending, for a player on no teams at all', () => {
    // `[]` is a real answer, exactly as it is for hasUnread.
    expect(chatHeading([], alpha)).toEqual({ kind: 'unnamed' })
  })
})

/**
 * THE SCROLL DECISIONS, WHICH ARE THE ONES MOST AT RISK OF NOT BEING TESTED AT
 * ALL. Every one of them is read from a live DOM element and acted on in an
 * effect, so the obvious place to write them is inline in message-list.tsx —
 * a `.tsx` file this suite (edge-runtime, no DOM, `*.test.ts` only) cannot
 * render at any price. Taking the three numbers as a plain object is what
 * makes them assertable; the component keeps only the reading and the
 * scrolling.
 */
const position = (partial: Partial<ScrollPosition>): ScrollPosition => ({
  scrollTop: 0,
  scrollHeight: 1000,
  clientHeight: 400,
  ...partial,
})

describe('isNearBottom', () => {
  it('follows a reader sitting at the very bottom', () => {
    expect(isNearBottom(position({ scrollTop: 600 }))).toBe(true)
  })

  // THE CASE THE WHOLE FUNCTION EXISTS FOR. Someone reading an hour-old
  // message must not be yanked to the newest one because a teammate typed.
  it('leaves a reader who has scrolled up to read history where they are', () => {
    expect(isNearBottom(position({ scrollTop: 0 }))).toBe(false)
  })

  // Fractional scrollTop on a non-integer-DPR display, plus a rounded
  // scrollHeight, routinely puts a reader who IS at the bottom a pixel or two
  // short of it. An exact comparison would stop following there.
  it('counts a reader a hair short of the bottom as being at it', () => {
    expect(isNearBottom(position({ scrollTop: 600 - NEAR_BOTTOM_SLACK_PX }))).toBe(true)
    expect(isNearBottom(position({ scrollTop: 600 - NEAR_BOTTOM_SLACK_PX - 1 }))).toBe(false)
  })

  // A freshly opened conversation with four messages in it. There is nothing
  // to scroll, so "scrolled away" is not a state it can be in — and reading it
  // as one would leave the first arriving message unfollowed.
  it('treats a list shorter than its own panel as being at the bottom', () => {
    expect(isNearBottom(position({ scrollTop: 0, scrollHeight: 120, clientHeight: 400 }))).toBe(true)
  })
})

describe('isAtTop', () => {
  it('is true at the start of what is loaded', () => {
    expect(isAtTop(position({ scrollTop: 0 }))).toBe(true)
  })

  it('is false anywhere else in the conversation', () => {
    expect(isAtTop(position({ scrollTop: 300 }))).toBe(false)
  })

  it('allows the same sub-pixel slack, on its own smaller budget', () => {
    expect(isAtTop(position({ scrollTop: AT_TOP_SLACK_PX }))).toBe(true)
    expect(isAtTop(position({ scrollTop: AT_TOP_SLACK_PX + 1 }))).toBe(false)
  })

  // With fewer messages than fill the panel there is no gesture that could
  // ever report arriving at the top, so a rule that waited for one would hide
  // "Load older" in exactly the case where it is the only way to see more.
  it('treats a list that cannot scroll as being at its top', () => {
    expect(isAtTop(position({ scrollTop: 0, scrollHeight: 120, clientHeight: 400 }))).toBe(true)
  })
})

describe('shouldShowLoadOlder', () => {
  const showing = (overrides: Partial<Parameters<typeof shouldShowLoadOlder>[0]> = {}) =>
    shouldShowLoadOlder({ canLoadOlder: true, windowLength: RECENT_WINDOW, atTop: true, ...overrides })

  it('offers history at the top of a full window', () => {
    expect(showing()).toBe(true)
  })

  // EXACTLY A FULL BATCH IS THE ONE THAT MUST STILL OFFER. `recentMessagesFor`
  // takes RECENT_WINDOW, so a window of exactly that size is the only shape
  // that can have more behind it — a `>` would retire the button on precisely
  // the conversations that have history.
  it('treats exactly a full window as possibly having more behind it', () => {
    expect(showing({ windowLength: RECENT_WINDOW })).toBe(true)
    expect(showing({ windowLength: RECENT_WINDOW + 1 })).toBe(true)
  })

  // A SHORT BATCH IS PROOF, NOT A HINT. The window is the newest
  // RECENT_WINDOW messages; coming back with fewer means that is the entire
  // history. Asking anyway spends one of the ten metered pages a minute on a
  // request that can only come back empty.
  it('does not offer history behind a window that came back short', () => {
    expect(showing({ windowLength: RECENT_WINDOW - 1 })).toBe(false)
  })

  it('offers nothing at all before any message has loaded', () => {
    expect(showing({ windowLength: 0 })).toBe(false)
    expect(showing({ windowLength: 0, canLoadOlder: false, atTop: false })).toBe(false)
  })

  // The caller's existing withholding rule — `atStart` set, or nothing held to
  // page back from — still wins on its own. This function narrows that
  // decision; it never overrides it.
  it('respects the route having already retired the control', () => {
    expect(showing({ canLoadOlder: false })).toBe(false)
  })

  // It sat above the newest messages, unconditionally, offering history to
  // everyone reading the live end of a conversation.
  it('stays out of the way of a reader at the live end', () => {
    expect(showing({ atTop: false })).toBe(false)
  })
})

describe('anchoredScrollTop', () => {
  // THE BUG (wordle-teams-9ozu): a scrollback page inserts above the reader
  // while the browser holds `scrollTop` constant, so what they were reading is
  // pushed down the viewport by the full height of the inserted page. 4200 -
  // 3000 is a page and a half of a 390x844 phone's message panel.
  it('moves the reader down by exactly what was inserted above them', () => {
    expect(anchoredScrollTop({ scrollTop: 0, scrollHeight: 3000 }, 4200)).toBe(1200)
  })

  // The reader is not always at 0 when the page lands — `isAtTop` allows a few
  // pixels of slack, and a fast scroll can be mid-flick.
  it('preserves an offset that was not exactly the top', () => {
    expect(anchoredScrollTop({ scrollTop: 6, scrollHeight: 3000 }, 4200)).toBe(1206)
  })

  // A page that came back empty inserts nothing, and the correction must then
  // be a no-op rather than a nudge.
  it('leaves the reader alone when nothing was inserted', () => {
    expect(anchoredScrollTop({ scrollTop: 120, scrollHeight: 3000 }, 3000)).toBe(120)
  })

  // A delete landing in the same commit can shrink the list past the reader's
  // offset. The browser coerces a negative scrollTop to 0 anyway; agreeing with
  // it here keeps the value we compute and the value the element holds the same
  // number.
  it('clamps to the top rather than going negative', () => {
    expect(anchoredScrollTop({ scrollTop: 50, scrollHeight: 3000 }, 2000)).toBe(0)
  })
})

/**
 * THE TIMEZONE IS PINNED EXPLICITLY IN EVERY ONE OF THESE, AND THAT IS NOT
 * DECORATION. This repo has shipped a date test that killed its mutant on the
 * author's machine and passed under `TZ=UTC`, which is what CI runs. The
 * mechanism here is a parameter rather than an env var or a mock: `separatorLabel`
 * and `chatDayIndex` take `timeZone`, so every assertion below names the zone it
 * is asserting in and the host's zone cannot reach any of them. The app passes
 * `undefined` and gets the reader's own zone, which is the only "today" a label
 * can honestly mean.
 *
 * AND EVERY TIMESTAMP IS AN ABSOLUTE INSTANT — `Date.parse` of a `Z` string, not
 * a local-time literal — so the fixtures are the same instants no matter where
 * they are read.
 *
 * NO CASE HERE IS DERIVED FROM THE CURRENT DATE, deliberately. The suite's test
 * count has drifted across a date rollover before; a fixed `now` fixture is both
 * a fixed count and a fixed set of expected strings.
 */
const utc = (iso: string) => Date.parse(iso)

// 2026-08-20 is a Thursday. Every relative label below is measured from noon on
// that day.
const NOW = utc('2026-08-20T12:00:00Z')

describe('separatorLabel', () => {
  it('says Today for a message on the same calendar day', () => {
    expect(separatorLabel(utc('2026-08-20T14:05:00Z'), NOW, 'UTC')).toBe('Today 14:05')
  })

  // THE h23 PIN. `hour12: false` resolves to the h24 cycle in some ICU builds
  // and renders this as `24:05`; `hourCycle: 'h23'` is the thing that was meant.
  it('renders midnight as 00:xx, not 24:xx', () => {
    expect(separatorLabel(utc('2026-08-20T00:05:00Z'), NOW, 'UTC')).toBe('Today 00:05')
  })

  it('says Yesterday for the calendar day before, however few hours ago that is', () => {
    // 23:58 the previous evening is twelve hours ago and is NOT "Today" — the
    // whole reason the comparison is on day indices rather than elapsed ms.
    expect(separatorLabel(utc('2026-08-19T23:58:00Z'), NOW, 'UTC')).toBe('Yesterday 23:58')
  })

  it('names the weekday inside the last week', () => {
    expect(separatorLabel(utc('2026-08-18T09:12:00Z'), NOW, 'UTC')).toBe('Tuesday 09:12')
    expect(separatorLabel(utc('2026-08-14T09:12:00Z'), NOW, 'UTC')).toBe('Friday 09:12')
  })

  // SEVEN DAYS IS THE EDGE, AND IT IS THE DATE SIDE OF IT. A weekday name only
  // identifies one day while there is one of it in living memory; "Thursday"
  // for a message exactly a week old names today as much as it names then.
  it('falls back to the date at exactly a week, and beyond it', () => {
    expect(separatorLabel(utc('2026-08-13T09:12:00Z'), NOW, 'UTC')).toBe('Aug 13, 2026 09:12')
    expect(separatorLabel(utc('2025-12-31T23:00:00Z'), NOW, 'UTC')).toBe('Dec 31, 2025 23:00')
  })

  // Small clock skew between the sender's device and the reader's is real, and
  // a message stamped a few minutes ahead on the same day is still "Today".
  it('reads a slightly-future stamp on the same day as Today', () => {
    expect(separatorLabel(utc('2026-08-20T12:03:00Z'), NOW, 'UTC')).toBe('Today 12:03')
  })

  it('names the date for a stamp far enough ahead to be strange', () => {
    expect(separatorLabel(utc('2026-08-25T08:00:00Z'), NOW, 'UTC')).toBe('Aug 25, 2026 08:00')
  })

  // THE POINT OF THREADING THE ZONE THROUGH AT ALL. One instant, two zones, two
  // different true answers — and neither of them is the host's.
  it('answers in the zone it is given, not in the one the host is in', () => {
    const instant = utc('2026-08-20T02:30:00Z')
    expect(separatorLabel(instant, NOW, 'UTC')).toBe('Today 02:30')
    expect(separatorLabel(instant, NOW, 'America/New_York')).toBe('Yesterday 22:30')
  })

  // DST, WHICH IS WHY chatDayIndex GOES THROUGH Date.UTC ON RESOLVED PARTS
  // RATHER THAN SUBTRACTING 86_400_000. 2026-11-01 is the Sunday US DST ends,
  // so the local day before it is 25 hours long; an elapsed-ms rule calls this
  // pair the same day.
  it('counts a 25-hour local day as one day', () => {
    const sunday = utc('2026-11-01T12:00:00Z')
    expect(separatorLabel(sunday, sunday, 'America/New_York')).toBe('Today 07:00')
    expect(separatorLabel(utc('2026-10-31T12:00:00Z'), sunday, 'America/New_York')).toBe(
      'Yesterday 08:00',
    )
  })
})

describe('chatDayIndex', () => {
  it('is one apart for two adjacent calendar days in the given zone', () => {
    expect(
      chatDayIndex(utc('2026-08-20T00:30:00Z'), 'UTC') -
        chatDayIndex(utc('2026-08-19T23:30:00Z'), 'UTC'),
    ).toBe(1)
  })

  // The same two instants are an hour apart and on the SAME local day in a zone
  // where neither has crossed midnight yet.
  it('is zero for two instants that share a calendar day in that zone', () => {
    expect(
      chatDayIndex(utc('2026-08-20T00:30:00Z'), 'America/New_York') -
        chatDayIndex(utc('2026-08-19T23:30:00Z'), 'America/New_York'),
    ).toBe(0)
  })
})

// A message fixture with a controllable author and stamp. `older` above is
// single-author by design; runs are entirely about the author changing.
const said = (playerId: string, createdAt: number): ChatMessage => ({
  _id: `msg_${playerId}_${createdAt}` as Id<'chatMessages'>,
  playerId: playerId as Id<'players'>,
  body: `${playerId}@${createdAt}`,
  createdAt,
})

const ME = 'player_me' as Id<'players'>
const THEM = 'player_them'

describe('separatorBefore', () => {
  it('always dates the oldest message on screen, which has nothing above it', () => {
    expect(separatorBefore(said(THEM, NOW), undefined, NOW, 'UTC')).toBe('Today 12:00')
  })

  it('stays out of the way of a continuing conversation', () => {
    const first = said(THEM, NOW - 10 * 60_000)
    expect(separatorBefore(said(ME, NOW), first, NOW, 'UTC')).toBeNull()
  })

  it('interrupts once the pause is longer than the separator gap', () => {
    const first = said(THEM, NOW - SEPARATOR_GAP_MS)
    expect(separatorBefore(said(THEM, NOW), first, NOW, 'UTC')).toBe('Today 12:00')
  })

  // A DAY BOUNDARY IS AN INDEPENDENT TRIGGER, not a consequence of the hour.
  // Five minutes across midnight is five minutes AND a different date, and the
  // second fact is the one a reader scrolling back needs.
  it('interrupts across midnight even five minutes apart', () => {
    const before = utc('2026-08-19T23:58:00Z')
    const after = utc('2026-08-20T00:03:00Z')
    expect(separatorBefore(said(THEM, after), said(THEM, before), NOW, 'UTC')).toBe('Today 00:03')
  })

  // ...and the same pair is NOT a boundary in a zone where neither instant has
  // crossed midnight, which is the zone parameter doing real work rather than
  // being threaded through for symmetry.
  it('does not interrupt across a midnight the reader is not at yet', () => {
    const before = utc('2026-08-19T23:58:00Z')
    const after = utc('2026-08-20T00:03:00Z')
    expect(
      separatorBefore(said(THEM, after), said(THEM, before), NOW, 'America/New_York'),
    ).toBeNull()
  })
})

describe('startsRun', () => {
  it('opens a run at the top of the list', () => {
    expect(startsRun(said(THEM, NOW), undefined, false)).toBe(true)
  })

  it('keeps one author talking in a single run', () => {
    expect(startsRun(said(THEM, NOW), said(THEM, NOW - 60_000), false)).toBe(false)
  })

  it('opens a run when the author changes, however fast the reply', () => {
    expect(startsRun(said(ME, NOW), said(THEM, NOW - 1_000), false)).toBe(true)
  })

  // EXACTLY THE GAP IS STILL THE SAME RUN; past it is a new one.
  it('opens a run once one author has paused longer than the run gap', () => {
    const previous = said(THEM, NOW - RUN_GAP_MS)
    expect(startsRun(said(THEM, NOW), previous, false)).toBe(false)
    expect(startsRun(said(THEM, NOW), said(THEM, NOW - RUN_GAP_MS - 1), false)).toBe(true)
  })

  // THE HALF THAT IS EASY TO MISS. A separator is a rule drawn through the
  // conversation; a run split across one would put the tail on the bubble above
  // it and leave the bubble below it unnamed.
  it('always opens a run below a separator, whatever the gap says', () => {
    expect(startsRun(said(THEM, NOW), said(THEM, NOW - 1_000), true)).toBe(true)
  })
})

describe('showsAuthorName', () => {
  it('names another person once, at the top of their run', () => {
    expect(showsAuthorName(true, false)).toBe(true)
    expect(showsAuthorName(false, false)).toBe(false)
  })

  // NEVER OVER YOUR OWN. The right-hand green column is already the whole of
  // that claim, and labelling it costs the asymmetry that identifies the other
  // side as somebody else.
  it('never names you to yourself', () => {
    expect(showsAuthorName(true, true)).toBe(false)
    expect(showsAuthorName(false, true)).toBe(false)
  })
})

describe('messageRows', () => {
  const shape = (rows: ReturnType<typeof messageRows>) =>
    rows.map((row) => ({
      mine: row.mine,
      startsRun: row.startsRun,
      endsRun: row.endsRun,
      showsName: row.showsName,
      separator: row.separator,
    }))

  it('groups a run and tails only its last bubble', () => {
    const rows = messageRows(
      [said(THEM, NOW - 120_000), said(THEM, NOW - 60_000), said(THEM, NOW)],
      ME,
      NOW,
      'UTC',
    )
    expect(shape(rows)).toEqual([
      { mine: false, startsRun: true, endsRun: false, showsName: true, separator: 'Today 11:58' },
      { mine: false, startsRun: false, endsRun: false, showsName: false, separator: null },
      { mine: false, startsRun: false, endsRun: true, showsName: false, separator: null },
    ])
  })

  it('starts a new run, and a new tail, when the other person replies', () => {
    const rows = messageRows([said(THEM, NOW - 60_000), said(ME, NOW)], ME, NOW, 'UTC')
    expect(shape(rows)).toEqual([
      { mine: false, startsRun: true, endsRun: true, showsName: true, separator: 'Today 11:59' },
      { mine: true, startsRun: true, endsRun: true, showsName: false, separator: null },
    ])
  })

  it('breaks the run at a separator and names the same author again below it', () => {
    const rows = messageRows(
      [said(THEM, NOW - SEPARATOR_GAP_MS - 60_000), said(THEM, NOW)],
      ME,
      NOW,
      'UTC',
    )
    expect(rows[0].endsRun).toBe(true)
    expect(rows[1].startsRun).toBe(true)
    expect(rows[1].showsName).toBe(true)
    expect(rows[1].separator).toBe('Today 12:00')
  })

  // THE LOADED-STATE BRANCH getMyPlayerId FORCES. `undefined` compares unequal
  // to every author, so without this every bubble would sit in the left column
  // for the first paint — which is what this asserts, rather than a crash.
  it('claims nothing is yours until getMyPlayerId has answered', () => {
    const rows = messageRows([said(THEM, NOW - 1_000), said('player_me', NOW)], undefined, NOW, 'UTC')
    expect(rows.map((row) => row.mine)).toEqual([false, false])
    // ...and `null`, its real "no player" answer, means the same thing here.
    expect(messageRows([said('player_me', NOW)], null, NOW, 'UTC')[0].mine).toBe(false)
  })

  it('holds an empty conversation without inventing a row', () => {
    expect(messageRows([], ME, NOW, 'UTC')).toEqual([])
  })

  // The last message on screen always closes its run, since there is nothing
  // below it to continue one.
  it('tails the newest message whatever came before it', () => {
    const rows = messageRows([said(ME, NOW - 60_000), said(ME, NOW)], ME, NOW, 'UTC')
    expect(rows[rows.length - 1].endsRun).toBe(true)
  })
})
