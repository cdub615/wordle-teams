import { cn } from '@/lib/utils'

type LetterInputProps = {
  answer: string
  letter: string
  letterIndex: number
  wordNum: number
}

export default function LetterInput({ answer, letter, letterIndex, wordNum }: LetterInputProps) {
  const getConditionalClasses = () => {
    if (!letter) return ''
    if (!answer.includes(letter)) return 'bg-muted'
    if (answer[letterIndex] === letter) return 'bg-green-600 dark:bg-green-700'
    if (answer.includes(letter)) return 'bg-yellow-400 dark:bg-yellow-500'

    return ''
  }
  const letterNum = letterIndex + 1

  return (
    <div
      className={cn('border h-12 md:h-16 text-3xl md:text-4xl uppercase flex justify-center items-center', getConditionalClasses())}
      id={`${wordNum}-${letterNum}`}
    >
      {letter}
    </div>
  )
}
