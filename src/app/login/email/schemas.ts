import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
})

export const signupSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
  firstName: z.string().min(1, 'Must be at least 1 character'),
  lastName: z.string().min(1, 'Must be at least 1 character'),
})
