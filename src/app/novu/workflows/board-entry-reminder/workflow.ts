import { workflow } from '@novu/framework'
import { renderEmail } from '../../emails/board-entry-reminder-email'
import { controlSchema, payloadSchema } from './schemas'
import { ControlSchema } from './types'

export const BoardEntryReminderEmailWorkflow = workflow(
  'board-entry-reminder-email',
  async ({ step, payload }) => {
    await step.email(
      'send-email',
      async (controls: ControlSchema) => {
        return {
          subject: controls.subject,
          body: await renderEmail(controls, payload),
        }
      },
      {
        controlSchema,
      }
    )
  },
  {
    payloadSchema,
  }
)

export const BoardEntryReminderPushWorkflow = workflow(
  'board-entry-reminder-push',
  async ({ step, payload }) => {
    await step.push(
      'send-push',
      async (controls: ControlSchema) => {
        return {
          subject: controls.subject,
          body: `It looks like you haven't yet entered your Wordle board for today. Don't miss out on those potential points!`,
        }
      },
      {
        controlSchema,
      }
    )
  },
  {
    payloadSchema,
  }
)
