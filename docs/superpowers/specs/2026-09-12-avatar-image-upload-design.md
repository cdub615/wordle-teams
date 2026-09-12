# Avatar image upload

**Date:** 2026-09-12
**Issue:** wordle-teams-wty4.1.1 (P2) · epic wordle-teams-wty4.1 · phase wordle-teams-wty4
**Status:** design approved, plan pending

## What we are building and why

A player can put a face next to their name. Today they cannot, and the reason is
narrower than "the feature is missing": `AvatarImage` reads Better Auth's
`user.image`, and **nothing in v2 ever writes that field**. It is populated only by
a social provider at sign-in. Google supplies one. Microsoft never does — deliberately,
per `PROVIDER_OPTIONS.microsoft`, because fetching it needs the `User.Read` admin-consent
gate that was ruled unacceptable for the 15 work/school users. An email-OTP account is
**permanently** initials-only.

### The finding that shaped the scope

The avatar renders in exactly **one** place: your own, in the header menu.
`initialsFor` has a single caller, `app-menu.tsx`. The four surfaces that show other
people — the scoreboard rows (`scores-table.tsx:402` renders a bare `row.firstName[0]`),
the today panel, the team card's member list, and chat messages — render no `Avatar`
at all.

So "avatar upload" as filed would have meant uploading a photo that **only you ever
see**, at 32px, inside a menu you have to open. The value of an avatar is other people
seeing it. Scope was therefore decided against that finding rather than against the
issue title.

**Decision taken 2026-09-12 (owner): own avatar + chat.** Not the scoreboard, the
team card, or the today panel. Chat is where "who said this" carries real weight, and
it is the free feature aimed at the 322 never-activated accounts. The scores table is
the densest, most mobile-critical surface in the app and was rebuilt from an approved
design very recently; putting 8–12 images into it is a separate decision with its own
layout risk, and it is explicitly **out of scope** here.

**Decision taken 2026-09-12 (owner): social seeds it, upload overrides it.** A social
image appears automatically where one exists; anyone may upload their own, and an
upload always wins. The consent objection — that this shows a photo to teammates that
a player had only ever shown to themselves — was raised and the owner decided against
gating it behind a prompt. It is mitigated by the fact that an avatar can be removed.

### Why it is in the launch rather than after it

The parent epic's argument applies unchanged: the launch email reaches every existing
player once, and chat is the item in Phase 7.5 that gives a never-activated user a
reason to open the app. A chat full of grey circles and initials is a colder room than
one with faces in it.

## The cost question, settled

The owner asked whether this should wait for a Convex upgrade. **It should not**, and
the reasoning is worth keeping because it is counterintuitive.

**The meters are different.** The pressure recorded in wordle-teams-yhii — 460.26 MB
against a 1 GB line — is **database I/O**, documents scanned, driven by
`teamStats.sweep`. Avatars do not touch it. They land on file storage and data egress,
which Convex meters separately (free tier: 1 GB file storage, 1 GB data egress, 0.5 GB
database storage, 1M function calls; Pro is $25/developer/month for 100 GB / 50 GB /
50 GB / 25M).

**File storage is a non-issue by two orders of magnitude.** 392 accounts at ~15 KB is
about 6 MB, or 0.6% of the free gigabyte. Even at 100 KB an avatar it is 39 MB.

**Egress is smaller than first estimated, because of two structural facts:**

1. **A social image costs Convex nothing.** It is a `lh3.googleusercontent.com` URL.
   The browser fetches it from Google. Only real uploads touch Convex storage at all,
   and most players will never upload one.
2. **The fan-out is a team, not the app.** Chat shows the authors present in one team's
   conversation, and teams are small. This is not a public feed.

An earlier estimate on the issue put the spread at ~400x between the careful and the
careless build, with a worst case of ~8 GB. **That figure assumed avatars on the
dashboard for every teammate on every page load, a fan-out this design does not
create.** It is superseded by this document. What survives from it is the discipline,
not the number: the resize and the server-side size cap below are what keep the
careless version from being reachable at all.

**Convex Pro would absorb a careless build, which is exactly why upgrading is the
wrong lever** — it makes sloppiness affordable rather than making it good. A mobile
chat pulling megabytes of images is a bad chat on any plan.

**Keep the Convex upgrade decision separate.** It is driven by database I/O and launch
traffic and has its own timeline: wordle-teams-6xw7's 30-day re-read closes around
2026-10-10. See also wordle-teams-fmuf, which questions whether the free-tier cap is
even hard any more.

## Key decisions, and what was ruled out

### Where the bytes live: Convex file storage

`generateUploadUrl()` → the client POSTs the resized blob → the `storageId` is saved
on the players row. It is the backend already in use, with no new credentials and no
new binding.

**Ruled out — Cloudflare R2.** Zero egress and the app is already on Workers, so it is
tempting. But it is a new binding, new credentials, and a third thing to configure per
environment — and wordle-teams-qjh3 has not yet split dev from prod. That is real setup
cost to solve a bandwidth problem that does not exist. It remains the escape hatch if
egress ever bites.

**Ruled out — a data URI on the players row.** Recorded explicitly so nobody
re-derives it as "simpler". It would be read by **every dashboard query that returns
players**, on the one meter that is actually tight. This is the single worst version of
this feature.

### A stored file is public-if-known

Convex's documentation is explicit: anyone with a file URL can fetch it without further
authentication, and access is revoked only by deleting the file. So an avatar URL is
effectively public, permanently, to anyone who obtains it. For a photo a player is
choosing to show their team this is acceptable — but it is a property of the design,
not an oversight, and it is why no other user content should follow this path without
rethinking it.

**Cache headers and URL stability are NOT documented** and must therefore be
**verified at implementation** rather than assumed. If Convex's storage URLs prove not
to be browser-cacheable, the fix is the Worker's existing Cache API pattern
(`src/server.ts`, wordle-teams-fqeq) — the app is on Workers, so edge-caching an avatar
costs one Convex fetch per avatar per PoP. Do not build that pre-emptively.

### No cropper

Resize and centre-crop to a square automatically. A crop UI means a library and a modal
in service of a 32px circle in a menu and a 24px one in chat, where nobody can tell
where the crop landed. If people report clipped faces, that is a follow-up with evidence
behind it.

### Free, not Pro

It is identity attached to chat, which is free. Paywalling what your own face looks like
to your own team would read as petty, and wordle-teams-efrc was looking for Pro features
with real utility rather than vanity gates.

## Architecture

### 1. Data model

Two optional fields on `players`:

```ts
// Mirrored from Better Auth's user.image at sign-in. A PROVIDER's URL
// (lh3.googleusercontent.com), never bytes we host or serve.
socialImage: v.optional(v.string()),
// An uploaded image in Convex file storage. ALWAYS WINS over socialImage.
imageId: v.optional(v.id('_storage')),
```

Both optional, so the schema push validates cleanly against every existing document —
the narrowing hazard described at length in `schema.ts` does not apply to added
optional fields.

Resolution, server-side:

```
imageId ? await ctx.storage.getUrl(imageId) : socialImage ?? null
```

**Two fields rather than one, and this is load-bearing.**
`overrideUserInfoOnSignIn: true` rewrites `user.image` on **every** social sign-in
(the fix from wordle-teams-wdp1). With a single field, the next social sign-in would
silently clobber an uploaded avatar. The discriminator is what prevents that, and it is
the reason a "just store one URL" simplification must be refused.

### 2. Chat reads it through the query that already exists

Chat resolves author names client-side from `team.members` (`chat.tsx:312`), which
comes from `api.teams.getMyTeams`; a `playerId` absent from that list renders as
"Former member". The avatar rides the same path: add `image` to the member objects
`getMyTeams` returns, and `message-list.tsx` picks it up with **no additional queries**.

**The bandwidth caveat, because this is the hot query.** `getMyTeamsFor` is the query
`dashboardBandwidth.test.ts` pins at 54 documents and the one wordle-teams-dcu is about.
A `_storage` lookup per member would add up to 54 system reads to every dashboard load.

The mitigation is free and mandatory: **call `getUrl` only when `imageId` is actually
set**. `socialImage` is a plain string already on the player document and costs nothing
extra. Since most players will never upload, the real added cost is near zero — but
`dashboardBandwidth.test.ts` must be updated as part of this work, and that test is
precisely the guard that should be forced to notice the change.

### 3. Social sync

A `players.syncSocialImage` mutation that **takes no arguments** and reads `user.image`
from the authenticated Better Auth user server-side. The client only triggers it, on app
load, when the resolved values differ.

**The client is never trusted with the value.** A client-supplied URL would let anyone
set their teammate-visible avatar to any URL on the internet.

`wordle-teams-bya` records that convex-test cannot exercise the Better Auth resolution
path, so the mutation stays a thin shell over a pure `shouldSyncSocialImage(current,
incoming)` predicate that **is** tested — the same shape as the untestable-wrapper
problem in wordle-teams-obw.

**Ruled out for v1 — a Better Auth `databaseHooks` handler.** Tidier, and it would fire
exactly where `overrideUserInfoOnSignIn` already writes. Rejected because it touches the
auth configuration for a feature that does not need it; revisit if the client-triggered
reconcile proves unreliable.

**Two consequences of "reads the authenticated user", stated so they are not
discovered:**

- **Only you can populate your own `socialImage`.** A teammate's Google photo does not
  appear in chat until **that teammate** next opens the app. This is inherent — their
  Better Auth user record is reachable only from their own session — and it is
  accepted rather than worked around. It means chat fills in with faces gradually over
  the days after launch rather than all at once.
- **The sync must be able to CLEAR.** If `user.image` is null and `socialImage` is set —
  a revoked provider, an unlinked account — `shouldSyncSocialImage` returns a clear
  rather than skipping. An avatar the provider no longer serves must not persist. An
  uploaded `imageId` is untouched by this in either direction.

### 4. Upload path

1. `generateAvatarUploadUrl` → `ctx.storage.generateUploadUrl()`
2. Client resizes: centre-crop to square, 256×256, WebP q0.85 → expect 8–20 KB
3. `setAvatar({ storageId })` — **server-side validation**: `ctx.storage.getMetadata`
   must report `image/*` and ≤100 KB, else **delete the object and reject**. Then patch
   `imageId` and **delete the previous object**.
4. `removeAvatar()` — delete the object, unset `imageId`, fall back to `socialImage`
   and then to initials.

**Step 3's size check is what makes the cost arithmetic real rather than
aspirational.** The client performs the resize, but a hostile or broken client can POST
the 12MP original straight to the upload URL. Deleting the superseded object matters
independently: wordle-teams-31a is already about storage that grows without bound.

### 5. Chat rendering

- A 24px avatar in a left gutter, on the **first message of each author's group** only,
  not on every bubble.
- **Others only, never your own.** `row.mine` is right-aligned and the alignment already
  identifies you; a gutter on both sides costs real width on a phone.
- **"Former member" shows no avatar.** The existing design deliberately withholds a
  departed author's name. Showing their face while hiding their name would leak exactly
  the identity that decision withholds.
- **No brand ring.** The rotating gradient is decoration for your own header avatar, not
  a chat element.

### 6. Profile tab

`SettingsTab` gains `'profile'`, alongside `'notifications'` and `'install'`. The tab
holds the avatar (current / upload / remove) and first + last name with a Save.

**Name editing is included deliberately, and it closes a real gap.** `completeProfile`
is the only writer of `firstName`/`lastName` outside the migration, and it runs once,
gated by `needsProfile` — so a player who typo'd their name at signup is stuck with it
on the scoreboard forever. The launch email reactivates 322 people, some of whom will
land on a scoreboard showing a name they would like to fix. A Profile tab containing
only an avatar would also be a strange room to build, when the name sits right beside
the avatar everywhere both appear.

`players.updateName` reuses `isCompleteName` from `convex/lib/invite.ts` — the same
guard `completeProfile` applies at `players.ts:146`. **Non-negotiable:** an empty name
pair reaches the scoreboard, the team card and the **winner computation**, per the
schema comment, and `display-names.ts` degrades in documented ways when either half is
blank.

## Error handling

- Upload failures, oversize rejections and unsupported types surface through
  `mutationErrorMessage` and a `sonner` toast, matching every other mutation in the app.
- A broken image URL — a rotted Google URL, a deleted storage object — falls through to
  `AvatarFallback`, which already renders initials and then a generic icon. No new
  error state is needed for that path.
- `syncSocialImage` failing is silent and non-blocking. It is a convenience, and a
  failed sync simply means initials until the next load.

## Testing

- `lib/avatar.ts` — centre-crop geometry, pure, `.test.ts`. The canvas call stays out of
  it so the arithmetic is testable in the edge-runtime default.
- `convex/players.test.ts` — `setAvatar` rejects oversize and wrong content type,
  deletes the superseded object; `removeAvatar` unsets and falls back; `updateName`
  rejects an empty pair.
- `*.hook.test.ts` (jsdom) — the Profile tab, and chat showing avatars for others but
  not for you and not for "Former member".
- `convex/dashboardBandwidth.test.ts` — updated for the new reads, deliberately.
- **Not relying on e2e.** It sits outside the four quality gates, so a spec there can go
  red without anything failing.

## Acceptance criteria

1. A player who signed in with email OTP can upload a picture, see it in their header
   menu and in team chat, and remove it again.
2. A player with a Google photo sees it in chat without doing anything, and can override
   it with an upload and revert to it by removing that upload.
3. A social sign-in after an upload does **not** replace the uploaded image.
4. `setAvatar` refuses an image over 100 KB or of a non-image type, and leaves no orphan
   in storage when it does.
5. Replacing an avatar leaves no orphan for the superseded image.
6. A player can change their first and last name, and an empty pair is refused.
7. Chat renders avatars for other authors only, never for `row.mine`, and never for
   "Former member".
8. `dashboardBandwidth.test.ts` reflects the new read count, and the added reads are
   zero for a player with no uploaded image.

## Out of scope

- A cropper UI.
- Avatars on the scoreboard, the team card or the today panel — the owner's Q1 decision.
  The scores table is the riskiest surface in the app and is its own decision.
- Moderation tooling. Teams are invite-only and small, and a team owner can already
  delete messages. Revisit if the population changes shape.
- Backfilling social images for players who never sign in socially again. Accepted, as
  wordle-teams-wdp1 accepted the same limitation.
- Animated avatars. The canvas resize flattens to a static image; this is a consequence
  rather than a feature decision, and no work is being done to support or refuse them
  beyond that.
