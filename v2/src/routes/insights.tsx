import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent } from '#/components/ui/card.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { benchmarkCredit, loadInsightsBenchmark } from '#/lib/insights-benchmark.ts'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { onATeamFrom, upsellFor } from '#/lib/insights-panel.ts'
import type { Boards } from '#/lib/insights-panel.ts'
import { isThin, MIN_BOARDS_FOR_STATS } from '#/lib/insights-personal.ts'
import { resolveInsightsSearch } from '#/lib/insights-search.ts'
import { useSearchSync } from '#/lib/use-search-sync.ts'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { DailyBenchmark } from '#/components/insights/daily-benchmark.tsx'
import { OpenersPanel } from '#/components/insights/openers-panel.tsx'
import { PersonalSummary } from '#/components/insights/personal-summary.tsx'
import { TeamSection } from '#/components/insights/team-section.tsx'
import { TrendPanel } from '#/components/insights/trend-panel.tsx'
import { TrialEndedCard } from '#/components/trial-ended-card.tsx'
import { UnlockPrompt } from '#/components/insights/unlock-prompt.tsx'
import { monthOf } from '../../convex/lib/puzzleDay.ts'
import { pageTitle } from '#/lib/seo'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * Layer 1 — the public benchmark.
 *
 * A TOP-LEVEL ROUTE, NOT A CHILD OF /app, and the plan decided this because the
 * spec does not: it matches /chat and /team, which are siblings for the same
 * reasons — signed-in only, their own screen, nothing for an anonymous visitor,
 * and the same beforeLoad redirect. public/robots.txt carries a Disallow line for
 * it, which src/crawler-metadata.test.ts enforces.
 *
 * THE CORPUS IS FETCHED HERE AND NOWHERE ELSE. This component is code-split by
 * the router, so a player who never opens insights never pays the ~79 KB. Do not
 * lift loadInsightsBenchmark() into a shared module the app shell imports; that
 * is the whole cost decision, and CI greps dist/client to keep it.
 */

/**
 * `?team=` AND `?month=` NAME WHAT THE PAGE IS SHOWING, the same two params the
 * dashboard carries and for the same reason: the URL is the source of truth, so
 * the view survives a link and a reload.
 *
 * SHAPE ONLY — VALIDITY IS NOT THIS FUNCTION'S JOB. It runs before anything is
 * loaded, with no team list and no clock, so all it can do is drop what is not a
 * string or not shaped like a month. Membership and the month window are
 * resolveInsightsSearch's questions (lib/insights-search.ts), answered by the
 * effect in InsightsRoute below.
 *
 * `validateSearch` IS EXHAUSTIVE — an undeclared param is dropped on the way in.
 * routes/app.tsx's `?join=` comment explains what that costs a link that needs
 * to carry something else.
 */
type InsightsSearch = { team?: string; month?: string }

export const Route = createFileRoute('/insights')({
  head: () => ({ meta: [{ title: pageTitle('Insights') }] }),
  validateSearch: (search: Record<string, unknown>): InsightsSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
    // Anything not shaped like a month is dropped rather than trusted; the
    // effect below then fills in the local current month.
    month:
      typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  // The same guard as /chat, /team and /app, for the same reason: every query
  // this page renders goes through requirePlayer on the server, so a visitor
  // without a session or without a player row lands on an error state rather
  // than a path anywhere.
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  component: InsightsRoute,
})

/**
 * The corpus, once per tab.
 *
 * NOT react-query: this is a static file with no key, no invalidation and no
 * server state — loadInsightsBenchmark already caches the promise. Wrapping it
 * would add a cache on top of a cache and a second thing to reason about.
 */
function useBenchmark() {
  const [benchmark, setBenchmark] = useState<InsightsBenchmark | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    loadInsightsBenchmark().then(
      (loaded) => live && setBenchmark(loaded),
      // The corpus failing to load is not the player's problem and not
      // actionable, so it degrades to a message rather than a toast.
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [])

  return { benchmark, failed }
}

function InsightsRoute() {
  const { team: teamParam, month: monthParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data, isPending } = useQuery(convexQuery(api.insights.myBenchmarkBoards, {}))
  const { benchmark, failed } = useBenchmark()

  /*
    THE ONLY READER OF THE ROSTER ON THIS PAGE, AND DELIBERATELY SO. Whether the
    viewer is on a team at all, which team `?team=` names, that team's name, and
    the month window the effect judges `?month=` by are all derived HERE and
    handed down as props, so one rule has one spelling. A second copy of this
    query inside TeamSection cost nothing on the wire (TanStack dedupes it) and
    still duplicated the PREDICATE, which is the part that drifts.

    It also keeps the panel's dependency on team membership a visible prop —
    -insights.hook.test.ts renders InsightsPanel directly, and a query hidden
    inside it can only be reached through the react-query mock, which reports
    every query as unresolved.

    NOT ON THE SERVER, THOUGH IT WOULD BE TIDIER THERE. Answering "is this player
    on a team" in myBenchmarkBoards means a full-table collect over teams —
    Convex cannot index array membership (see the schema comment) — and that
    query is the exact subject of wordle-teams-dcu, where database BANDWIDTH and
    not function calls is the binding free-tier limit. The client already holds
    this for TeamSection; paying for it again on the server to save a prop is the
    wrong trade in this project.

    THE EFFECT BELOW NEEDS IT TOO: resolveInsightsSearch checks `?team=` against
    the teams the viewer is actually on, and reaches each team's `createdAt` for
    the month window it judges `?month=` by.
  */
  const { data: teams } = useQuery(convexQuery(api.teams.getMyTeams, {}))

  /*
    THE ONE PLACE `?team=` BECOMES A TEAM. A param naming a team the viewer has
    left, or one that is pure invention, finds nothing here and is corrected by
    the effect below — so nothing downstream ever holds an id Convex would answer
    with NOT_A_MEMBER.
  */
  const selectedTeam = teams?.find((team) => team.id === teamParam)

  /*
    FILLS IN OR CORRECTS `?team=` AND `?month=`, AND REMEMBERS THE TEAM. Both
    effects moved into lib/use-search-sync.ts (wordle-teams-1ubk), which /app
    shares — the second half of this was byte-identical there, and the first
    differed only in the resolver. The hydration rule, the `teams ?? []`, and the
    remembered-team write all have their reasoning in that hook's header now,
    where there is one copy of each.

    `navigate` IS PASSED RAW, AND THAT IS LOAD-BEARING. See the hook's `navigate`
    prop: a closure built here would be a fresh function every render sitting in
    the effect's dependency array. This page never had that flaw; /app did, and
    the shared hook is what fixes it there rather than spreading it here.
  */
  useSearchSync({
    teamParam,
    monthParam,
    teams,
    resolve: resolveInsightsSearch,
    navigate,
    to: Route.fullPath,
  })

  return (
    /* THE CAP IS NESTED INSIDE page-max, NOT COMBINED WITH IT ON ONE ELEMENT,
       and this is not a style preference. `.page-max` is declared UNLAYERED in
       styles.css while every Tailwind utility lives in `@layer utilities`, and
       unlayered declarations beat layered ones outright regardless of source
       order or specificity. `class="page-max max-w-3xl"` therefore renders at
       --page-max's 1440px and the cap silently does nothing. wordle-teams-wty4.1.2
       already paid to learn this on /team; team.tsx:195 is the shape to copy. */
    <main className="page-max mt-2 md:mt-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* THE SHAPE IS team.tsx'S AND chat.tsx'S, DOWN TO THE aria-label. This
          page was the only one carrying a "Back" text label, and three pages
          that go back differently is a worse outcome than any one of the
          shapes on its own. NO `-ml-2`: team.tsx and chat.tsx do not have one,
          and adding it here would reintroduce an 8px difference between this
          page's back arrow and /team's — the exact inconsistency this comment
          claims to be removing. */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
            <Link to="/app">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Insights</h1>
        </div>

        <InsightsScope data={data} />

        {/*
        FIRST THING IN THE MAIN CONTENT, ABOVE THE LOADING STATE AND THE PANELS
        IT EXPLAINS. `myAccess` is its own query, independent of the benchmark
        corpus and myBenchmarkBoards below — a player whose trial ended still
        needs to see this whether or not the benchmark happens to be loading,
        failed, or empty this render, so it does not live inside any of those
        branches.
      */}
        <TrialEndedCard />

        {isPending || (!benchmark && !failed) ? (
          <div className="space-y-3" data-testid="insights-loading">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : failed ? (
          <p className="text-muted-foreground">
            The benchmark data could not be loaded. Try again in a moment.
          </p>
        ) : !data || data.boards.length === 0 ? (
          <p className="text-muted-foreground">
            Enter a board and we will show you how it compares.
          </p>
        ) : (
          <InsightsPanel
            benchmark={benchmark!}
            data={data}
            teams={teams}
            /*
              LAYER 3 IS BUILT HERE AND HANDED OVER AS A NODE, because
              everything it needs is settled here: the selected team, the
              month, and `navigate`. InsightsPanel decides only WHERE it goes
              — see its `teamSection` prop, and wordle-teams-kkhj for why four
              props stopped being drilled through it.
            */
            teamSection={
              <TeamSection
                layer3={data.access.layer3}
                teams={teams}
                team={selectedTeam}
                month={monthParam}
                /*
                  THE NAVIGATION LIVES HERE, WHERE `navigate` DOES, AND IS
                  HANDED DOWN AS A CALLBACK — the same shape routes/app.tsx
                  uses for TeamPicker and MonthPicker, and for a second reason
                  on top of consistency: a control that called `useNavigate()`
                  for itself could not be rendered in a jsdom component test
                  without a router around it, and every component test in this
                  project renders the component bare.

                  A TEAM CHANGE KEEPS THE CURRENT MONTH, which is what the
                  dashboard's own picker does. It can name a month the NEW
                  team's window does not reach (a younger team, or one created
                  after that month); nothing here has to guard for it, because
                  the effect above re-runs on the new `?team=` and
                  resolveInsightsSearch judges `?month=` against the SELECTED
                  team's window — see its own comment on why the window is the
                  selected team's and not the requested one's.

                  NO `replace`, UNLIKE THE CORRECTING EFFECT ABOVE. Picking a
                  team or a month is somewhere the reader chose to go, so Back
                  should return them to where they were; the effect's
                  navigations are corrections nobody asked for and would be a
                  Back trap.

                  `resetScroll: false` ON BOTH, AND THIS IS THE EXACT OPPOSITE
                  OF WHAT routes/app.tsx DOES WITH ITS OWN PICKERS
                  (wordle-teams-wty4.1.16). That is deliberate on both sides,
                  not a drift between two pages, and the reason is simply WHERE
                  THE CONTROL SITS. app.tsx's comment says its TeamPicker and
                  MonthPicker "sit at the top of the grid and can only be
                  operated from there, so resetting scroll costs nothing" —
                  true there, and false here. InsightsPanel renders personal,
                  then openers, THEN this section, then the day list: insights-
                  daily was measured at 1233px from the top of the document
                  (wordle-teams-m08r), so these controls are well below a 720px
                  fold. A reader operating them has scrolled to reach them, and
                  the router's `scrollRestoration: true` was throwing them back
                  to the top of a page they had just scrolled down.

                  THE CORRECTING EFFECT CARRIES THE SAME FLAG, and it has to:
                  changing to a younger team can invalidate `?month=` and fire a
                  SECOND navigation out of use-search-sync.ts, which would undo
                  this one. See that hook for why the flag is right for /app too.
                */
                onTeamChange={(team) =>
                  void navigate({
                    to: Route.fullPath,
                    search: { team, month: monthParam },
                    resetScroll: false,
                  })
                }
                onMonthChange={(month) =>
                  void navigate({
                    to: Route.fullPath,
                    search: { team: teamParam, month },
                    resetScroll: false,
                  })
                }
              />
            }
          />
        )}
      </div>
    </main>
  )
}

/**
 * What the page is computed from. Nothing on the page stated this before, so a
 * player had no way to tell whether a number covered their whole history or
 * only what the current tier unlocks.
 *
 * ABSENT RATHER THAN ZERO while the query is in flight or empty: "0 boards" is
 * a claim, and the loading and empty branches below already say the true thing.
 */
export function InsightsScope({ data }: { data: Boards | null | undefined }) {
  if (!data || data.boards.length === 0) return null
  const earliest = data.boards.reduce(
    (min, board) => (board.puzzleDay < min ? board.puzzleDay : min),
    data.boards[0].puzzleDay,
  )
  return (
    <p className="text-muted-foreground mb-4 ml-8 text-xs" data-testid="insights-scope">
      {data.boards.length} {data.boards.length === 1 ? 'board' : 'boards'} · since{' '}
      {formatMonthLabel(monthOf(earliest))}
    </p>
  )
}

/**
 * EXPORTED SO IT CAN BE RENDERED IN A TEST, and safe to export where the ROUTED
 * component is not. src/routes.test.ts pins the distinction: the vite plugin
 * declines to code-split a route file whose routed identifier is also exported,
 * and silently — but a sibling export is fine, which is why login-error.tsx
 * exports LoginErrorPage. `InsightsRoute` above must stay unexported.
 *
 * Acceptance criterion 5 needs a real render: that Layer 1 appears for a FREE
 * player on their first board, with the CC BY 4.0 credit visible.
 */
export function InsightsPanel({
  benchmark,
  data,
  teams,
  teamSection,
}: {
  benchmark: InsightsBenchmark
  data: Boards
  /**
   * THE ROSTER, AND THE ONLY THING THIS PANEL ASKS OF IT: whether it is empty,
   * for the upsell. `undefined` while getMyTeams is in flight, which `upsellFor`
   * treats as its own answer — it withholds the pitch rather than guessing that
   * a viewer has no team.
   *
   * IT USED TO ARRIVE AS A SECOND PROP AS WELL. The route computed `onATeam`
   * from this same list two lines away and passed both, and nothing enforced
   * that they agreed. `onATeamFrom` is now the one derivation, shared with
   * TeamSection, which asks it for its own no-team card (wordle-teams-kkhj).
   */
  teams?: Array<{ id: Id<'teams'>; name: string }>
  /**
   * LAYER 3, ALREADY BUILT, as a node rather than as its props — the same shape
   * TeamPanel and DailyTeamFact take their `controls` in, and for the same
   * reason here as there.
   *
   * WHAT IT REPLACES: `team`, `month`, `onTeamChange` and `onMonthChange`, four
   * props this component never read. They existed only to be handed on to
   * TeamSection, which lives in its own file now — a four-prop drill through a
   * component that does not care, and exactly what wordle-teams-kkhj asked to be
   * removed. The route holds `navigate` and the settled params, so the route is
   * where the section is built.
   *
   * OPTIONAL, because the panel's layout is the panel's own: a caller with no
   * Layer 3 to show (every component test that is not about Layer 3) renders
   * everything else unchanged rather than having to construct one.
   */
  teamSection?: ReactNode
}) {
  const credit = benchmarkCredit(benchmark)
  const upsell = upsellFor({
    layer1: data.access.layer1,
    layer2: data.access.layer2,
    layer3: data.access.layer3,
    boardCount: data.boards.length,
    onATeam: onATeamFrom(teams),
  })

  /*
    THE SUMMARIES LEAD AND THE DAY-BY-DAY LIST FOLLOWS, which is the reverse of how
    this shipped and is a correction rather than a preference. A pro player holds
    up to 400 boards, so rendering one card each ABOVE the summaries buried both
    of the panels they actually pay for under roughly four hundred screens of
    scroll. Reported by the owner: "Your Team and Your History are buried below
    miles of daily insights."

    The order is the same for a free player, whose list is one board, so nothing
    branches on tier here — the daily section is simply last, and bounded.
  */
  return (
    <div className="space-y-3">
      {data.access.layer2 === 'full' && (
        <>
          {/*
            THE THIN STATE IS A DESIGNED ONE, NOT A FAILURE — see isThin's own
            comment: Layer 2 is empty for 368 of 392 accounts and that is
            expected. It used to live inside PersonalHistory, which owned all
            three of "insights-personal", "insights-personal-thin" and
            "insights-months"; PersonalHistory is now deleted (OpenersPanel and
            TrendPanel took the first and third of those testids over, and
            PersonalSummary's Card now also answers to "insights-personal" —
            see that component's own comment) and this is the one branch of it
            that had nowhere else to go, since the tier check it depends on
            (`data.access.layer2 === 'full'`) already lives here.
          */}
          {isThin(data.boards) ? (
            <Card data-testid="insights-personal-thin">
              <CardContent className="pt-6">
                <UnlockPrompt
                  what="Your history"
                  need={MIN_BOARDS_FOR_STATS}
                  have={data.boards.length}
                  unit="boards"
                  value="your opening repertoire, your streaks and how your scores move month to month"
                  testId="insights-personal-thin-prompt"
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <PersonalSummary boards={data.boards} />
              {/* SAME GATE AS PersonalSummary, FOR THE SAME REASON:
                  openerRepertoire and difficultySplit both happily compute
                  over a couple of boards, and a repertoire of one opener or a
                  difficulty split drawn from two days is worse than no panel
                  at all. */}
              <OpenersPanel benchmark={benchmark} boards={data.boards} />
              <TrendPanel boards={data.boards} />
            </>
          )}
        </>
      )}

      {/* LAYER 3 SITS HERE, between the personal panels and the daily benchmark,
          and that position is this component's to own even though the section
          itself is built by the route — the same division `controls` draws
          inside TeamPanel. */}
      {teamSection}

      <DailyBenchmark benchmark={benchmark} data={data} />

      {/* A CARD, NOT A MUTED LINE ABOVE THE FOOTER. The string is unchanged and
          upsellFor is untouched — placement and conversion copy belong to
          wordle-teams-iht. What changes is only this page's visual state, which
          is what wty4.1.11 owns. THE ACCENT BORDER IS WHAT SEPARATES IT FROM AN
          UnlockPrompt: this one asks for money, and an unlock prompt asks for
          play, which is why those are deliberately muted. */}
      {upsell && (
        <Card className="border-accent-solid/40">
          <CardContent className="pt-6 text-sm" data-testid="insights-upsell">
            {upsell}
          </CardContent>
        </Card>
      )}

      {/*
        ATTRIBUTION IS AN OBLIGATION, NOT A COURTESY. CC BY 4.0 requires credit
        where the data is shown, so it renders on the surface itself and is read
        OUT OF THE ARTIFACT rather than written here — a credit hardcoded beside
        the data it credits is a credit that can drift from it. The release and
        snapshot ids ride along because the difficulty numbers are revised
        between snapshots, so "which numbers were these" is a real question.
      */}
      <footer className="text-muted-foreground border-t pt-3 text-xs" data-testid="insights-attribution">
        Benchmark data from{' '}
        <a className="underline" href="https://www.fiveletterwords.io/data">
          {credit.attribution}
        </a>
        , licensed{' '}
        <a className="underline" href={credit.licenceUrl}>
          {credit.licence}
        </a>
        . Difficulty snapshot {credit.snapshotId}.
      </footer>
    </div>
  )
}
