# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

The repository root IS the app (TanStack Start + Convex + Cloudflare Workers).
Until 2026-09-28 it lived under `v2/`; if you find a command or comment that says
`cd v2`, it is stale.

```bash
pnpm install

TZ=UTC pnpm test:once   # vitest
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint . --max-warnings 0
pnpm build              # vite build + scripts/build-sw.mjs
```

**Run all four SEPARATELY and read each exit code.** They fail independently and
routinely: `build` does not typecheck (vite strips types), `lint` reaches files
the others never load, and a docs-only change can fail `test:once` because some
suites assert against documentation content. In the last session alone, `lint`
and `typecheck` each caught a failure the other three gates passed.

**Never pipe a gate into `tail`/`grep` to read its result.** `PIPESTATUS` is empty
in this zsh, so `$?` is the pipe's exit code and a red gate reads as green.
Redirect to a file, read `$?`, then inspect the file.

```bash
pnpm e2e                # Playwright — NOT one of the gates, and not run by them
```

E2E takes ~11 minutes and exceeds the default foreground command timeout; run it
in the background. It needs a Convex backend on :3210 — `CONVEX_AGENT_MODE=anonymous`
provisions a local one that requires no secrets.

That local backend must have `E2E_TEST_MODE`, `CHALLENGES_ENABLED` and
`LEAGUES_ENABLED` set to `true`, as CI sets them in `deploy-v2.yml`. Without the
last two, `challenge.spec.ts` and `leagues.spec.ts` fail at their first assertion.
`.env.local` holds the production `CONVEX_DEPLOY_KEY`, which the CLI prefers over
`CONVEX_DEPLOYMENT`, so target the local backend only through `--env-file` with a
file containing just `CONVEX_DEPLOYMENT=anonymous:anonymous-v2`, e.g.
`pnpm exec convex env set LEAGUES_ENABLED true --env-file <that file>`.

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
