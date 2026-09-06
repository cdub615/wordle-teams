/**
 * Team chat's numbers, and NOTHING ELSE.
 *
 * THIS FILE HAS NO IMPORTS, AND THAT IS ITS ENTIRE REASON FOR EXISTING.
 * The composer needs MAX_BODY_LENGTH so the client's cap cannot disagree with
 * the server's, and importing it from lib/chat.ts shipped a broken route to
 * beta: lib/chat.ts imports `accessError` from ../access.ts, access.ts imports
 * ./auth.ts, and auth.ts THROWS AT MODULE SCOPE when process.env.SITE_URL is
 * unset — which in a browser it always is. A module-scope throw is a side
 * effect, so no bundler may tree-shake it away, and the whole auth module rode
 * into the client chunk behind one integer.
 *
 * The symptom was nasty precisely because it was narrow: /chat is a lazily
 * loaded chunk, so every other route worked perfectly and the server was
 * entirely healthy. It cost an afternoon of chasing deployments, env vars,
 * caches and service workers before the shape of the failure — one route,
 * only that route — gave it away.
 *
 * SO: anything the frontend needs from chat's rules lives here, and this file
 * imports nothing. If you are about to add an import to it, you are about to
 * reintroduce that bug; put the thing that needs the import in lib/chat.ts
 * instead, which is server-only.
 */

/** The longest message the server will accept. Enforced by requireBody. */
export const MAX_BODY_LENGTH = 2000

/** Twenty messages a minute, per player per team. See nextPostWindow. */
export const RATE_LIMIT_MESSAGES = 20
export const RATE_LIMIT_WINDOW_MS = 60_000

/** How many messages a client loads when it opens a conversation. */
export const RECENT_WINDOW = 30

/**
 * One message document, as a round estimate. THE SINGLE PLACE THIS NUMBER
 * LIVES: BYTES_PER_DELETE_WAKE and BYTES_PER_SCROLL_PAGE are both built from
 * it, and they were once separate copies of the same literal expression.
 * Change it here and every cost in the meter moves together, which is the only
 * way they stay comparable to each other.
 */
export const BYTES_PER_MESSAGE_ESTIMATE = 250

/**
 * What one client's wake costs us, in bytes, as a round upper bound: roughly
 * 200B for the pointer read (chatMeta plus the budget row, both small) and
 * ~250B for the one new message it then fetches.
 */
export const BYTES_PER_WAKE = 450

/**
 * 700MB of Convex's 1GB monthly database-I/O allowance, leaving headroom for
 * every other query in the app. Crossing it degrades chat, never the app.
 */
export const BUDGET_THRESHOLD_BYTES = 700 * 1024 * 1024

/**
 * Ten pages a minute, per player per team — a deliberately different number
 * from RATE_LIMIT_MESSAGES, because a scroll page and a post are not the same
 * shape of cost. A post is priced per team member (budgetIncrementFor) but
 * cheap per call; a scrollback page is priced once, for the one client that
 * asked, but at a full RECENT_WINDOW of messages — see budgetIncrementForScroll.
 * Ten a minute is generous for a human paging through history (a deliberate
 * "load everything" session covers 300 messages, ten times the initial
 * window, inside one minute) while still bounding what a scroll loop can cost:
 * at ten pages a minute one runaway client can charge at most
 * 10 * BYTES_PER_SCROLL_PAGE (75KB) a minute against the shared budget, the
 * same order of magnitude as the send limit's worst case for a small team.
 */
export const RATE_LIMIT_SCROLLS = 10

/**
 * What a DELETE costs a connected client, which is not what a message costs.
 *
 * A delete bumps `revision` without moving `lastMessageAt`, and a client seeing
 * that must refetch its whole window rather than append — it cannot know WHICH
 * message vanished. So it pays RECENT_WINDOW messages at the same per-message
 * estimate BYTES_PER_WAKE is built from, not one. That makes a delete roughly
 * 17x a send, and it is the single most expensive operation in the feature.
 */
export const BYTES_PER_DELETE_WAKE = RECENT_WINDOW * BYTES_PER_MESSAGE_ESTIMATE

/**
 * What a scrollback page costs: one RECENT_WINDOW read — numerically the same
 * figure as BYTES_PER_DELETE_WAKE, because both are "one client reads a full
 * window", just reached by different paths.
 *
 * NOT MULTIPLIED BY TEAM SIZE, unlike budgetIncrementFor (a send, felt by
 * every connected client on the next wake) and budgetIncrementForDelete (a
 * forced refetch, also felt by every connected client). Scrollback is a
 * one-shot fetch the caller asked for; nobody else's client does any work
 * because of it, so nobody else is charged for it.
 */
export const BYTES_PER_SCROLL_PAGE = RECENT_WINDOW * BYTES_PER_MESSAGE_ESTIMATE
