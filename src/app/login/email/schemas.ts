import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
})

export const signupSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
  firstName: z.string().min(1, 'Must be at least 1 character'),
  lastName: z.string().min(1, 'Must be at least 1 character'),
})

// Lives here rather than beside the form so the server action can share it. The
// form used to declare its own copy and never call it, which is how a submit
// with no code reached supabase.auth.verifyOtp and came back as 'Verify requires
// either a token or a token hash'.
export const otpSchema = z.object({
  otp: z.string().length(6, 'Your one-time passcode must be 6 digits.'),
  email: z.string().email('Please enter a valid email that includes @ and .'),
})
