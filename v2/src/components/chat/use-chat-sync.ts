import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The live pointer for one team's chat.
 *
 * THIS IS THE ONLY SUBSCRIPTION CHAT HOLDS. Everything else is fetched in
 * response to it changing. The pointer is two small documents; a naive
 * subscription to the message window would be ~17x more expensive per wake,
 * which is the whole argument of the design's section 4.
 */
export function useChatPointer(teamId: Id<'teams'>) {
  return useQuery(convexQuery(api.chat.pointer, { teamId }))
}
