import { Resend } from '@convex-dev/resend'
import { components } from './_generated/api'

// testMode: false — real deliveries; the component defaults to test-only recipients otherwise.
export const resend = new Resend(components.resend, { testMode: false })
