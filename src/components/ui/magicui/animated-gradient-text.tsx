import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

export default function AnimatedGradientText({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative mx-auto flex max-w-fit flex-row items-center justify-center px-4 py-1.5 transition-shadow duration-500 ease-out [--bg-size:300%]',
        className
      )}
    >
      <div
        className={`absolute inset-0 block h-full w-full`}
      />

      {children}
    </div>
  )
}
