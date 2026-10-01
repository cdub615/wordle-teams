<p align="center">
  <a href="https://wordleteams.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./public/wt-icon-144x144.png">
      <img src="./public/wt-icon-144x144.png" height="128">
    </picture>
    <h1 align="center">Wordle Teams</h1>
  </a>
</p>

<p align="center">
  <a aria-label="Join the community on GitHub" href="https://github.com/cdub615/wordle-teams/discussions">
    <img alt="" src="https://img.shields.io/badge/Join%20the%20community-indigo.svg?style=social&labelColor=000000&logo=github&logoWidth=20">
  </a>
  <a aria-label="Changelog" href="https://feedback.wordleteams.com/changelog">
    <img alt="" src="https://img.shields.io/badge/Changelog-blueviolet.svg">
  </a>
</p>

Wordle Teams is an open-source companion to the daily Wordle: you play the word
wherever you normally do, then enter your board here so a monthly scoreboard
builds up across the people you already send your score to every morning.

Live at **[wordleteams.com](https://wordleteams.com)**.

> **v2 went live on 2026-09-30.** The app was rebuilt from the ground up:
> Next.js, Supabase and Vercel gave way to **TanStack Start, Convex and
> Cloudflare Workers**. If you are reading this expecting the Next.js codebase,
> it is gone — see [v1 → v2](#v1--v2) below.

## Features

- **Teams** — create a team, invite by email or a shareable link, and play the
  month out together. Two teams are free.
- **Daily board entry** — type the day's result in, in about ten seconds, or
  **import it from a screenshot** and check what we filled in.
- **Monthly scoring** — scores apply by number of attempts, the month adds up,
  and somebody wins it. Team owners can define their **own scoring system** for
  the current month; past months stay settled.
- **Insights** — your guess average against your own record, how your attempts
  are spread, which openers actually work for you, and the same depth on your
  team, member by member, for any month you choose.
- **Team chat** — argue about the word with the people who actually played it,
  with a push when the thread moves.
- **Reminders** — a nudge at a time you pick, by email or push, on the days you
  have yet to play.
- **Installable PWA** — home-screen install, offline shell, iOS splash screens
  and web push.
- **Passwordless auth** — email one-time codes, with passkeys offered after
  first sign-in.
- **Pro** — more teams, your whole team's history rather than three months,
  screenshot import, custom scoring and the full Insights set, billed through
  Polar.

## Stack

| Layer | What we use |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) (React 19, TanStack Router, Vite 8) |
| Backend | [Convex](https://convex.dev) — database, functions, scheduled jobs, file storage |
| Auth | [Better Auth](https://better-auth.com) via `@convex-dev/better-auth` — email OTP + passkeys |
| Hosting | [Cloudflare Workers](https://workers.cloudflare.com) — SSR and the edge cache, deployed with Wrangler |
| UI | Tailwind CSS v4, shadcn/ui on Radix, Lucide icons |
| Billing | [Polar](https://polar.sh) |
| Email | [Resend](https://resend.com) via `@convex-dev/resend` |
| Monitoring | Sentry, LogSnag |
| Testing | Vitest (unit, `convex-test`, jsdom hook tests) and Playwright (e2e) |

## Getting started

### Prerequisites

- **Node.js 22** (what CI runs)
- **pnpm 11.20+** — the repo pins it via `packageManager`, so `corepack` will
  pick the right one up

### Install

```bash
git clone https://github.com/cdub615/wordle-teams.git
cd wordle-teams
pnpm install
```

### Run it

The app needs a Convex backend. The quickest way to get one with no secrets and
no account is Convex's anonymous local backend:

```bash
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev   # one terminal, backend on :3210
pnpm dev                                           # another, app on :3000
```

`convex dev` writes the deployment's URLs into `.env.local` for you. Against
your own Convex deployment instead, the client needs:

```bash
CONVEX_DEPLOYMENT=dev:your-deployment
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_CONVEX_SITE_URL=https://your-deployment.convex.site
```

Everything else is set **on the Convex deployment** (`convex env set NAME value`),
not in `.env.local`. Only `SITE_URL` is required; each of the rest just leaves
the feature it powers switched off:

| Variable | Powers |
| --- | --- |
| `SITE_URL` | auth callbacks and email links — sign-in does not work without it |
| `RESEND_API_KEY` | all outbound email — sign-in codes, invites, reminders |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push |
| `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRO_MONTHLY_PRODUCT_ID`, `POLAR_PRO_ANNUAL_PRODUCT_ID`, `POLAR_SERVER` | Pro checkout and subscription webhooks |
| `REMINDERS_ENABLED`, `REMINDERS_ALLOWLIST`, `SWEEPS_ENABLED` | the scheduled jobs in `convex/crons.ts` |
| `E2E_TEST_MODE` | the test-only sign-in path Playwright uses (never set in production) |

Public build-time values (`VITE_*`) live in `.env.production` and
`wrangler.jsonc`; nothing secret is committed.

## Scripts

```bash
pnpm dev            # vite dev on :3000
pnpm build          # vite build, then scripts/build-sw.mjs for the service worker
pnpm preview        # build + vite preview
pnpm lint           # eslint . --max-warnings 0
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest, watch mode
pnpm test:once      # vitest run
pnpm e2e            # playwright test (~11 min; needs a Convex backend on :3210)
pnpm deploy         # build + wrangler deploy
```

Four gates run in CI and they fail independently — `build` does not typecheck,
and `lint` reaches files the others never load — so run them separately and read
each exit code:

```bash
TZ=UTC pnpm test:once
pnpm typecheck
pnpm lint
pnpm build
```

A few assets are **generated on demand and committed** rather than built on
every deploy, because each needs a browser or the network: `pnpm build:splash`
(iOS launch images), `pnpm build:shots` (marketing screenshots) and
`pnpm fetch:fonts` (self-hosted Inter and Geist).

## Project layout

```
convex/        schema, queries, mutations, actions, crons, Better Auth component
src/routes/    file-based TanStack routes (marketing, app, API handlers)
src/components/ UI — board entry, teams, chat, insights, onboarding, pricing
src/lib/       shared logic and copy, unit-tested alongside the code it feeds
src/server.ts  the Cloudflare Worker: SSR, edge cache, maintenance switch
e2e/           Playwright specs
scripts/       build and generate-on-demand scripts
docs/          design system, runbooks, plans and specs
supabase/      v1 schema, kept for the migration path only
```

## Deployment

Both environments deploy from `.github/workflows/deploy-v2.yml`, which lints,
typechecks, unit-tests and runs the full Playwright suite against a local Convex
backend before it ships anything.

| Branch | Convex | Worker | Host |
| --- | --- | --- | --- |
| `dev` | `successful-canary-135` | `wordle-teams-v2-dev` | dev.wordleteams.com |
| `main` | `fabulous-goldfish-949` | `wordle-teams-v2` | wordleteams.com |

The Worker reads a `MAINTENANCE` var at runtime, so the site can be put behind a
maintenance page from the Cloudflare dashboard without a deploy.

## v1 → v2

v1 was Next.js on Vercel with Supabase for data and auth. v2 keeps the product
and replaces the platform: TanStack Start for the app, Convex for data,
functions and scheduling, Better Auth for sign-in, and Cloudflare Workers for
SSR at the edge. Accounts, teams, boards and scores were migrated across;
`supabase/` and `convex/migrate.ts` remain as the record of that path and are
not part of the running app. The cutover itself is written up in
`docs/runbooks/2026-cutover.md`.

## Contributing

Contributions are welcome.

1. Fork the repository and branch from `dev`.
2. Make your changes, with tests — `src/lib` and `convex/` are both covered
   closely, and new behaviour is expected to be.
3. Run all four gates above and make sure each one passes.
4. Open a pull request against `dev` describing what changed and why.

## License

MIT. See [LICENSE](./LICENSE).

## Acknowledgments

- Wordle, the original game that started all of this
- TanStack, Convex, Better Auth, Cloudflare, Tailwind, shadcn/ui, Radix, Polar
  and Resend
