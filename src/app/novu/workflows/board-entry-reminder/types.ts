import { z } from 'zod'
import { payloadSchema, controlSchema } from './schemas'

export type PayloadSchema = z.infer<typeof payloadSchema>
export type ControlSchema = z.infer<typeof controlSchema>