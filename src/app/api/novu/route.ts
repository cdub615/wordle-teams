import { BoardEntryReminderEmailWorkflow } from '@/app/novu/workflows'
import { serve } from '@novu/framework/next'

export const { GET, POST, OPTIONS } = serve({
  workflows: [BoardEntryReminderEmailWorkflow],
})
