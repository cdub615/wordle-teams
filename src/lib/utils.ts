import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const baseUrl = (host: string | null) => `${process?.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}`

const passwordRegex = `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*.?#^)(-_=+|}{':;~\`&])[A-Za-z\d@$!.%*?#^)(-_=+|}{':;~\`&]{6,20}$`

export { baseUrl, cn, passwordRegex }
