import { createStart } from '@tanstack/react-start'
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from '@sentry/tanstackstart-react'

// Sentry middlewares must come first so they capture errors from everything
// registered after them.
export const startInstance = createStart(() => ({
  requestMiddleware: [sentryGlobalRequestMiddleware],
  functionMiddleware: [sentryGlobalFunctionMiddleware],
}))
