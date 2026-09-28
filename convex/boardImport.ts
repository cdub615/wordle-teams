import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { requirePlayer } from './access.ts'

/**
 * The correction log for board import — Stage 5's half of the feature.
 *
 * WHY THIS EXISTS AT ALL, since nothing reads it in the app: it is the labelled
 * corpus. wordle-teams-418's acceptance asks for one built from real
 * screenshots, and seventy players of whom ten are most of the activity cannot
 * supply it any other way. Every confirm that changed something writes the
 * tiles it changed, which is precisely the label Stage 3 can be scored against.
 *
 * NO IMAGE EVER REACHES THIS. The parse runs entirely in the browser and
 * nothing is uploaded; a letter and a tile position carry the whole
 * measurement. That is what makes the per-parse cost zero and leaves nothing to
 * disclose, and it is not a detail to trade away later.
 */

/** More tiles than a board has. A caller sending more is confused, not helpful. */
export const MAX_CORRECTIONS = 36

export const logCorrections = mutation({
  args: {
    puzzleDay: v.string(),
    corrections: v.array(
      v.object({
        target: v.union(v.literal('guess'), v.literal('answer')),
        row: v.number(),
        column: v.number(),
        read: v.string(),
        actual: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    // A board is six rows of five plus a five-letter answer: 35 tiles. Anything
    // past that is a client bug, and silently storing it would put junk in the
    // one corpus the accuracy figure is measured against.
    const corrections = args.corrections.slice(0, MAX_CORRECTIONS)
    const createdAt = Date.now()

    for (const correction of corrections) {
      await ctx.db.insert('boardImportCorrections', {
        playerId: player._id,
        puzzleDay: args.puzzleDay,
        ...correction,
        // Single letters only. The client sends one per tile; anything longer
        // is a bug, and truncating keeps a bad row from poisoning a count.
        read: correction.read.slice(0, 1).toUpperCase(),
        actual: correction.actual.slice(0, 1).toUpperCase(),
        createdAt,
      })
    }

    return { logged: corrections.length }
  },
})
