import { serve } from '@novu/framework/next'
import { BoardEntryReminderEmailWorkflow, BoardEntryReminderPushWorkflow } from '../../novu/workflows'

export const { GET, POST, OPTIONS } = serve({
  workflows: [BoardEntryReminderEmailWorkflow, BoardEntryReminderPushWorkflow],
})
