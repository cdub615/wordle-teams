import { LayoutGrid, Lock, Rocket, ThumbsUp, Trophy, Users } from 'lucide-react'

/**
 * The six feature cards, copy and icons ported verbatim from v1's
 * src/components/home/feature-cards.tsx.
 *
 * THE COLOURS ARE THE ONLY THING THAT CHANGED, AND THEY HAD TO. v1 hardcodes
 * `bg-secondary-foreground dark:bg-secondary` on the section and
 * `text-gray-50` / `text-gray-400` on its contents — a dark slab with two greys
 * on it, spelled as a raw Tailwind palette colour, which src/styles.css's rule 1
 * calls out by name ("a raw green-600 outside this file is a missing token").
 * Against v2's token set those literals are wrong twice over: `secondary` here
 * resolves to --surface-sunken (#f4f4f5 light), so `bg-secondary-foreground`
 * would be a near-black band in light mode and `dark:bg-secondary` a #1c1c1c one
 * in dark, and gray-400 body text would sit at ~2.6:1 on the light band.
 *
 * The translation keeps the SHAPE — a band of a different shade from the page,
 * with a strong heading and a quieter paragraph — and takes the values from the
 * design system: --surface-sunken is exactly "one step off --background" in both
 * themes, and it pairs with --text / --text-muted, which is the "background and
 * foreground travel together" rule. Both greys clear AA against it.
 *
 * THE ICONS ARE `text-accent-solid`, WHICH IS A DELIBERATE DEPARTURE FROM v1.
 * v1 paints them the same grey as the heading because on a black slab there
 * were only two values available. On a neutral band the design system's third
 * rule applies instead — "one accent per surface. Green earns attention" — and
 * six feature icons are precisely the thing on this section that should. One
 * accent, used once, on the one surface that has room for it.
 */
const FEATURES = [
  {
    icon: Users,
    title: 'Create Teams',
    body: 'Invite your friends to join your Wordle team and compete together.',
  },
  {
    icon: LayoutGrid,
    title: 'Wordle Boards',
    body: 'Enter your daily Wordle board and track your progress.',
  },
  {
    icon: Trophy,
    title: 'Competitive Scoring',
    body: 'Using our default scoring system or your own, compete to earn the highest score and win.',
  },
  {
    icon: Rocket,
    title: 'Go Pro',
    body: 'Become a Pro member to get access to unlimited months, unlimited teams, customizable scoring systems, and more.',
  },
  {
    icon: ThumbsUp,
    title: 'Easy Sign In',
    body: 'No need to manage another username and password. Sign in quickly and easily with your existing accounts.',
  },
  {
    icon: Lock,
    title: 'Privacy',
    body: 'We take your privacy seriously. We only collect what we need for a seamless sign in experience, and we never sell or share your user data.',
  },
] as const

export function FeatureCards() {
  return (
    <section className="w-full bg-surface-sunken py-12 md:py-24 lg:py-32">
      <div className="page-wrap grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16 lg:grid-cols-3 lg:gap-20">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex flex-col items-center gap-4 text-center">
            <Icon className="h-12 w-12 text-accent-solid" aria-hidden="true" />
            <h3 className="font-display m-0 text-2xl font-bold text-foreground">{title}</h3>
            <p className="m-0 text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
