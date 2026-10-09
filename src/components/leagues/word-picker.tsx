import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { cn } from '#/lib/utils.ts'
import { GroupPicker, type PickerGroup } from './group-picker.tsx'

/** A popular group. Server views carry `slug`; without one, the lower-cased name is the word. */
export type PopularWord = PickerGroup & { slug?: string }

type AnswerWords = typeof import('../../../convex/lib/answerWords.ts')

type Props = {
  popular: PopularWord[]
  currentWord: string | null
  onPick: (word: string) => void
  disabled?: boolean
  /** Accessible name of the quick-pick group. */
  label?: string
  className?: string
}

const wordOf = (g: PopularWord) => g.slug ?? g.name.toLowerCase()

/**
 * Keep what can be a letter, at most five. NFKC first so a fullwidth paste
 * (ＣＲＡＮＥ) survives; everything else (spaces, zero-width, digits) is dropped.
 */
const lettersOf = (raw: string) => raw.normalize('NFKC').replace(/[^a-z]/gi, '').slice(0, 5)

/**
 * The OPEN-WORD PICKER for Starting Words (spec v2 §5): the most popular words
 * as quick picks (GroupPicker, so names and described member counts are
 * unchanged) plus a box for any Wordle answer word.
 *
 * THE ANSWER LIST IS LAZY. convex/lib/answerWords.ts is ~20 KB raw and this
 * component sits on the home card inside the dashboard chunk, so the list is
 * imported dynamically the first time the box is focused or typed in and kept
 * in state. normalizeWord travels in the same module rather than being split
 * out: nothing here needs it before the list exists (quick picks use the
 * group's slug; Join and the hint wait for the list anyway), so splitting would
 * buy nothing but a second module. Until it loads, Join stays disabled and no
 * hint shows. The server is the authority (UNKNOWN_WORD); this list only
 * drives live feedback.
 */
export function WordPicker({ popular, currentWord, onPick, disabled = false, label = 'Choose a group', className }: Props) {
  const [input, setInput] = useState('')
  const [words, setWords] = useState<AnswerWords | null>(null)
  const loading = useRef(false)
  const mounted = useRef(true)
  const id = useId()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = () => {
    if (words || loading.current) return
    loading.current = true
    import('../../../convex/lib/answerWords.ts').then(
      (mod) => {
        if (mounted.current) setWords(mod)
      },
      () => {
        // A failed chunk load (offline, a deploy mid-session) retries on the next focus or keystroke.
        loading.current = false
      },
    )
  }

  const word = words ? words.normalizeWord(input) : null
  const valid = words !== null && words.isAnswerWord(input)
  const showHint = words !== null && input.length === 5 && !valid
  const canJoin = valid && !disabled && word !== null

  const current = currentWord === null ? null : (popular.find((g) => wordOf(g) === currentWord.toLowerCase())?._id ?? null)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {popular.length > 0 && (
        <GroupPicker
          groups={popular}
          currentGroupId={current}
          disabled={disabled}
          label={label}
          onPick={(groupId) => {
            const group = popular.find((g) => g._id === groupId)
            if (group) onPick(wordOf(group))
          }}
        />
      )}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (canJoin) onPick(word)
        }}
      >
        <Label htmlFor={`${id}-word`}>Any Wordle answer word</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-word`}
            value={input.toUpperCase()}
            onFocus={load}
            onChange={(e) => {
              load()
              setInput(lettersOf(e.target.value).toLowerCase())
            }}
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={showHint || undefined}
            aria-describedby={`${id}-hint`}
            className="font-mono uppercase tracking-widest"
          />
          <Button type="submit" disabled={!canJoin}>
            Join
          </Button>
        </div>
        <p id={`${id}-hint`} aria-live="polite" className="min-h-5 text-sm text-destructive">
          {showHint ? 'Not a Wordle answer word' : ''}
        </p>
      </form>
    </div>
  )
}
