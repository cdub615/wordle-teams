/**
 * Merge into tailwind.config.ts → theme.extend.colors
 *
 * The existing shadcn color block stays exactly as it is (it reads the Layer 3
 * aliases, which still resolve). This adds the Layer 2 semantic names so new
 * code can write `bg-surface`, `text-muted`, `bg-wordle-correct`, etc.
 */

export const v2Colors = {
  surface: {
    DEFAULT: 'hsl(var(--surface))',
    sunken: 'hsl(var(--surface-sunken))',
    inverse: 'hsl(var(--surface-inverse))',
  },
  text: {
    DEFAULT: 'hsl(var(--text))',
    muted: 'hsl(var(--text-muted))',
    subtle: 'hsl(var(--text-subtle))',
  },
  line: {
    subtle: 'hsl(var(--border-subtle))',
    strong: 'hsl(var(--border-strong))',
  },
  brand: {
    from: 'hsl(var(--brand-from))',
    via: 'hsl(var(--brand-via))',
    to: 'hsl(var(--brand-to))',
  },
  success: {
    DEFAULT: 'hsl(var(--success))',
    foreground: 'hsl(var(--success-foreground))',
  },
  warning: {
    DEFAULT: 'hsl(var(--warning))',
    foreground: 'hsl(var(--warning-foreground))',
  },
  danger: {
    DEFAULT: 'hsl(var(--danger))',
    foreground: 'hsl(var(--danger-foreground))',
  },
  wordle: {
    correct: 'hsl(var(--wordle-correct))',
    present: 'hsl(var(--wordle-present))',
    absent: 'hsl(var(--wordle-absent))',
    border: 'hsl(var(--wordle-tile-border))',
  },
} as const

/**
 * Note on `line` vs `border`: Tailwind already generates border-* utilities from
 * the `borderColor` key and the existing `border` color token. Naming the new
 * pair `line` avoids colliding with `--border` while both sets coexist. Rename
 * to `border` once the Layer 3 aliases are deleted.
 */
