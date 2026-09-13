import { createAuthClient } from 'better-auth/react'
import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { emailOTPClient } from 'better-auth/client/plugins'
// The browser half of convex/auth.ts's `passkey()`. It carries no relying-party
// config of its own on purpose: the rpID and the accepted origins are the
// server's to decide, and the client only drives the WebAuthn ceremony.
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({
  plugins: [convexClient(), emailOTPClient(), passkeyClient()],
})
