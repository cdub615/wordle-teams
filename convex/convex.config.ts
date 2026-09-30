import { defineApp } from 'convex/server'
// LOCAL INSTALL (wordle-teams-hrqw): the component is defined in this repo so
// we own its schema. Same mount name, so components.betterAuth and every
// existing row are unchanged.
import betterAuth from './betterAuth/convex.config'
import resend from '@convex-dev/resend/convex.config.js'

const app = defineApp()
app.use(betterAuth)
app.use(resend)
export default app
