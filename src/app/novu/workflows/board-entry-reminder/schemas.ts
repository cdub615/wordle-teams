import { z } from 'zod'

export const payloadSchema = z.object({
  previewText: z.string().default('Board Entry Reminder'),
  wordleTeamsImage: z
    .string()
    .url()
    .default(
      'https://dcfqzbdusxhrfgvnpwqc.supabase.co/storage/v1/object/public/images/wordle-teams-title.png'
    ),
  wtIconImage: z
    .string()
    .url()
    .default(
      'https://dcfqzbdusxhrfgvnpwqc.supabase.co/storage/v1/object/public/images/wt-icon.png'
    ),
  email: z.string().email(),
  firstName: z.string(),
})

export const controlSchema = z.object({
  subject: z.string().default('Board Entry Reminder'),
})
