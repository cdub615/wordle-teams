import {z} from 'zod'
import { passwordRegex } from '@/lib/utils'

const LoginSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
  password: z
    .string()
    .regex(
      new RegExp(passwordRegex),
      'Must contain between 6 and 20 characters, at least one uppercase letter, one lowercase letter, one number, and one special character'
    ),
})
const SignupSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
  password: z
    .string()
    .regex(
      new RegExp(passwordRegex),
      'Must contain between 6 and 20 characters, at least one uppercase letter, one lowercase letter, one number, and one special character'
    ),
  firstName: z.string().min(1, 'Must be at least 1 character'),
  lastName: z.string().min(1, 'Must be at least 1 character'),
})

const validEmail = (emailAddress: string) =>
    emailAddress.length > 1 &&
    emailAddress.includes('@') &&
    emailAddress.substring(emailAddress.lastIndexOf('@')).includes('.')

export { LoginSchema, SignupSchema, validEmail }