# PWA launch screen and startup speed — fill the black hold, then attribute it

**Design for `wordle-teams-c0f` (post-v2 roadmap #6).** Written 2026-09-08,
after a brainstorm with the owner, during Phase 7.5 (`wordle-teams-wty4`).

It replaces `c0f`'s stub body. The baseline it is built on was measured during
that brainstorm and is recorded in full as a note on `c0f`.

---

## Why this exists

For the people who use this daily, the installed PWA *is* the app. Tapping the
icon gives an unbranded blank hold before anything appears — it reads as broken,
every day, to exactly the users worth keeping.

The stub asserted that. It is now measured.

## The baseline

Five iOS screen recordings, 1179×2556 at 60fps, cellular only (Wi-Fi off), app
force-quit between every run, service worker primed beforehand so these measure
steady state rather than first launch. Markers extracted with `ffmpeg
signalstats` frame by frame rather than by eye:

- `t0` — last frame of the launcher before the black hold (launch animation start)
- `t1` — first sustained non-black frame (our first paint)
- `t2` — first frame where the score band matches its settled state and stays

| run | `t0` | `t1` | `t2` | blank hold | tap → board |
|---|---|---|---|---|---|
| 1 *(coldest)* | 4.410 | 7.485 | 8.218 | **3.075 s** | **3.808 s** |
| 2 | 2.650 | 4.468 | 5.152 | 1.818 s | 2.502 s |
| 3 | 2.583 | 4.518 | 5.302 | 1.935 s | 2.718 s |
| 4 | 2.350 | 4.435 | 5.202 | 2.085 s | 2.852 s |
| 5 | 2.525 | 4.368 | 5.035 | 1.843 s | 2.510 s |
| **median (5)** | | | | **1.935 s** | **2.718 s** |
| median (2–5) | | | | 1.889 s | 2.614 s |

**Roughly 73% of the launch is a black screen.** Of a ~2.6 s steady-state
launch, ~1.9 s is nothing at all.

**And it is pure black, not our background colour.** Measured brightness during
the hold is 2.97/255; `#0a0a0a` would read near 10. iOS is painting nothing, not
painting our colour.

The paint sequence after the hold is identical in all five runs:

```
t1 + 0.0s   shell only — header and footer, main area empty
t1 + ~0.4s  skeleton placeholders
t1 + ~0.7s  real board data
```

So ~0.7 s happens after first paint and ~1.9 s before it.

## Four findings from the code that shaped this design

### 1. There are zero `apple-*` tags in the served document

Not just the startup images. `apple-mobile-web-app-capable` is absent too, and
on iOS that meta has historically been a precondition for `apple-touch-startup-image`
being honoured at all. Verified against the live beta document, not inferred:
`grep -aoiE 'apple-[a-z-]+'` over `GET /login` returns nothing.

### 2. Adding the capable meta is not a reversal of the `black-translucent` decision

`__root.tsx` records why `apple-mobile-web-app-status-bar-style: black-translucent`
is deliberately not set: it forces light status-bar text regardless of theme, and
this app has a light mode. The stated cost is that the top safe-area inset is 0
in iOS standalone.

`apple-mobile-web-app-capable` is a different tag with a different effect: it
declares the app web-app-capable, and it is `status-bar-style` — a tag this
design does **not** add — that forces the status-bar text colour. The two are
separable, so this design adds one and leaves the other, and extends the
existing comment to say so — because the next reader will otherwise see an
`apple-mobile-web-app-*` meta appear and assume the argument was lost.

The separation is asserted from the tags' documented roles, and the app already
launches standalone from the manifest, so the capable meta should be inert for
everything except startup images. **That is checked on the device, not assumed**:
the same recording used to verify the splash also confirms the status bar and
the top inset are unchanged. If they are not, the finding is reported and the
decision reopened deliberately — not absorbed.

### 3. Startup images must match full device resolution, but the web view starts below the status bar

This rules out an otherwise appealing option. A splash that mimics the app shell
— header bar and empty board frame, so the handoff is seamless — would jump
vertically at handoff, because the image covers the status bar area and the
rendered app does not. A centred mark is immune to that offset. A fake shell is
not.

### 4. Every document eagerly preloads the entire app

The root route's manifest lists 32 `rel="modulepreload"` entries, including
chunks for `chat`, `insights`, `team`, `about`, `privacy`, `terms`,
`join.$token`, `maintenance`. `/login` pulls 36 JS files, ~299 KB brotli /
~1.4 MB raw, of which `index-*.js` alone is 150 KB br / 468 KB raw.
`modulepreload` is an eager high-priority fetch, not a prefetch.

The cause looks structural: `routeTree.gen.ts` statically imports all 19 route
modules and `tanstackStart()` is called with no options in `vite.config.ts`, so
every route's component graph is a root dependency — downloaded *and executed*
on every launch.

**This is a hypothesis with a plausible mechanism, not a finding.** It is
recorded here so Part 2 has somewhere to start, and it does not get implemented
until profiling says that is where the time goes.

---

## What we are building

### Part 1 — the launch screen

Generate `apple-touch-startup-image` sets from an HTML template rendered by
Playwright at exact device sizes; commit the output to `public/`.

**Content.** The `wt-icon` mark above the gradient "Wordle Teams" logotype,
centred. Dark set on `#0a0a0a`, light set on `#fafafa` — the `--background`
token for each theme in `src/styles.css`, read from there rather than hardcoded
a second time, so a palette change cannot leave the splash behind.

**Coverage.** Portrait iPhone sizes for devices running current iOS, light and
dark — roughly 12 × 2 = ~24 files. Sizes that share CSS points but differ in
pixel ratio (XR/11 at `414×896@2x` versus XS Max/11 Pro Max at `414×896@3x`)
must be disambiguated with `-webkit-device-pixel-ratio` in the media query, or
one will silently shadow the other.

**Graceful degradation is the coverage policy.** A device with no matching image
falls back to today's behaviour — the black hold. So partial coverage is never a
break, only a missed improvement. That is why iPad is out of scope rather than
guessed at.

**Why Playwright and not `sharp`.** `sharp` is not a v2 dependency (the memory
about it failing on clean install is v1's Next.js build). Playwright already is.
Rendering an HTML template also means the wordmark uses the app's real CSS
gradient and font rather than a re-drawn approximation, so it cannot drift from
the header.

**Why generated and committed rather than built.** Matches the repo's existing
precedent for generated artifacts — `scripts/build-insights-corpus.mjs` and
`scripts/fetch-wordlists.mjs` both generate on demand and commit the output,
deliberately keeping the network and the generation step out of `pnpm build`.

### Part 2 — attribute the 1.9 s, then one optimisation

Split the black hold between: cellular RTT and TLS, the three serial server
stages, document download, and JS parse/exec.

The three server stages are:

```
__root beforeLoad → fetchAuth() → getToken()          stage 1
/app   beforeLoad → needsProfile (awaited alone)      stage 2
/app   loader     → 4 Convex queries in parallel      stage 3
```

Server-side cost is device-independent, so stages can be measured from a
workstation without a phone. Reference points already taken against beta from
broadband, five runs each: `/home` 101–671 ms, `/login` 155–440 ms, and `/app`
anonymous (a 307 that exercises stage 1 only and issues **zero** Convex queries)
**147–449 ms**, of which connect+TLS is ~55 ms.

Then **one** targeted optimisation, chosen from what the numbers say. Re-measure
with the same five-run protocol.

---

## Instrumentation

The `hasPwa` capture and `isStandaloneDisplay()` in `src/lib/use-local-capture.ts`
already provide a tested standalone detector (both the `display-mode` media query
and iOS's `navigator.standalone`). Nothing new is needed to know an installed
launch from a browser one.

Sentry browser tracing is already live at `TRACES_SAMPLE_RATE = 0.2` with the
TanStack router integration, which is the natural place to notice regressions
later. **It cannot be used for that yet**: neither `Sentry.init` call sets
`environment`, so both SDKs default to `"production"` and beta traces are
indistinguishable from production ones. Filed as `wordle-teams-9wpd`; this epic
depends on it only if the regression-watch task is taken up, not for Parts 1 or 2.

## Testing

Unit-testable: the device matrix and the media-query strings it produces are
data, so the generator's mapping from device entry to `<link media>` is pinned
by a test the way `lib/seo.ts`'s tag list is. The generator's *output* is not
asserted pixel by pixel — it is checked for existence, dimensions and
non-uniformity (a solid-colour splash means the template failed to render, and
that is exactly the silent failure `build-sw.mjs` was written to prevent for the
service worker).

Not unit-testable, and honest about it: whether iOS actually honours the images.
That is verified on the device with the same five-run recording protocol, and it
is the only proof that matters.

Any non-route file added under `src/routes/` needs a `-` filename prefix or the
router warns on every build.

## Acceptance criteria

1. `apple-mobile-web-app-capable` and the `apple-touch-startup-image` link set
   are present in the served document, and `__root.tsx`'s comment explains why
   the `black-translucent` decision is untouched.
2. The generator script produces the full matrix from one source template,
   output committed, network and generation kept out of `pnpm build`.
3. A branded launch screen is confirmed present on the installed iOS app by
   screen recording — the hold is no longer black.
4. Cold start measured on the owner's iPhone (1179×2556, iOS, cellular), five
   runs, median reported, before and after, using the `t0`/`t1`/`t2` frame-marker
   protocol. Before is recorded on `c0f` already.
5. The 1.9 s blank hold is attributed across RTT/TLS, the three server stages,
   document download, and JS parse/exec, with the numbers written to `c0f`.
6. One optimisation chosen from that attribution is implemented and re-measured.
7. All four gates green: `tsc`, `vitest`, `eslint`, `build`. Playwright is a
   blocking CI gate before any deploy.

**The device caveat is part of the criteria, not a footnote.** The original
wording asked for "a real mid-range phone", which is hardware nobody has. The
measurement is on a current-generation iPhone and is therefore a **best case**,
not a representative one. The criteria name the device actually used.

## Explicitly out of scope

**Rendering the previous session's board from cache.** The stub called this "the
biggest perceived-speed lever". The measurement retires it, and the argument is
recorded here so it is not re-litigated:

- To paint before the network answers, the service worker would have to serve a
  cached document. That is exactly what `wordle-teams-bpt` forbids, and for a
  good reason — one person's rendered dashboard served to the next person on a
  shared device, after sign-out. `src/sw.ts`'s `NetworkOnly` navigation route
  exists to prevent precisely that.
- The alternative, a neutral client-rendered shell, trades ~1.9 s of black for
  ~1.9 s of grey skeleton and probably makes real data land *later*, because the
  data fetch would start after hydration instead of during SSR.
- Once the splash covers that 1.9 s with branding, the thing that made it feel
  broken is gone. Reopening a security decision to replace black pixels with grey
  ones is a bad trade.

Also out: push notification work (Phase 6 owns it), native app wrappers or app
store submission, broad visual redesign, iPad splash coverage, landscape splash
coverage (the app is portrait; a landscape launch degrades to today's behaviour).

### Approaches ruled out

**Baselining v1 on production.** Matches the original criteria literally and uses
the install needed for cutover anyway, but the after-delta would conflate the
replatform with this epic, and the number becomes unrepeatable once DNS flips.
Baseline is v2 on beta so before and after measure the same codebase.

**In-app timing panel as the primary instrument.** `navigationStart` fires
*after* the OS has launched the process and initialised the web view, so the
browser's own clock structurally cannot see the blank hold this epic is about.
Web Inspector is not an option either — it needs macOS, and the dev machine is
Arch. Screen recording is the only instrument that sees the whole window.

**A splash that mimics the app shell.** Ruled out on finding 3 above.

**Forcing the standalone launch to dark so one splash set suffices.** Halves the
assets by overriding a user's explicit light-mode choice. Rejected.
