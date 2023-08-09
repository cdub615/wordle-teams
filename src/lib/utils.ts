import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const baseUrl = (host: string | null) => `${process?.env.NODE_ENV === 'development' ? 'http' : 'https'}://${host}`

export { baseUrl, cn }
