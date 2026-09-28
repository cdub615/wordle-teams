// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because the
// only claim worth making about this component is what a BROWSER computes from
// it — an accessible name — and that needs a real DOM. `.hook.test.ts` matches
// the existing precedents, and `.test.ts` rather than `.test.tsx` because
// vitest.config.ts's glob is `src/**/*.test.ts`, so the elements go through
// `createElement` by hand.
//
// IT REPLACES A SOURCE-TEXT ASSERTION THAT COULD PASS VACUOUSLY. While the
// badge lived inside routes/login.tsx it was unrenderable, so its two
// requirements were pinned by slicing the file with
// `/function LastUsedBadge\(\)[\s\S]*?\n\}/` and running regexes over the
// slice. That slice ends at the first line-initial `}`: wrapping the span in a
// fragment or a conditional truncates it mid-component, after which
// `not.toMatch(/aria-hidden|sr-only/)` is satisfied by the remains. A test that
// silently stops testing is bad anywhere and worst here, because the constraint
// it guards is the accessibility one. Moving the component to components/ is
// what let this be executed instead of matched.
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LastUsedBadge } from './last-used-badge.tsx'
import { Button } from './ui/button.tsx'

afterEach(cleanup)

describe('the last-used marker', () => {
  test('lands in the ACCESSIBLE NAME of the control it marks', () => {
    // RENDERED THE WAY /login renders it — inside the button, as a child — so
    // this measures the composition rather than the span. getByRole computes
    // the name the way a browser does, so `aria-hidden` on the badge, a bare
    // `title`, or replacing the words with a coloured dot all fail here, and
    // each of those is a plausible "tidy up the button label" edit.
    render(createElement(Button, null, 'Google', createElement(LastUsedBadge, null)))

    // A REGEX, AND THE OPTIONAL SPACE IN IT IS NOT SLOPPINESS — it is the one
    // part of this a DOM without CSS cannot decide. The accessible-name
    // algorithm inserts a separator between two children only when the second
    // produces a block-level box, which is decided by computed `display`. In a
    // real browser the badge is a flex item of the Button (`inline-flex`), so it
    // is BLOCKIFIED and the name is "Google Last used"; jsdom loads no Tailwind,
    // computes `display: inline` for a bare span, and concatenates to
    // "GoogleLast used". Measured, not assumed — this test first failed here.
    // Pinning either literal would assert a fact about jsdom's stylesheet
    // instead of about the component, so both words are pinned and only the gap
    // between them is left to the engine.
    expect(screen.getByRole('button', { name: /^Google\s*Last used$/ })).toBeDefined()
  })

  test('and is VISIBLE text, not a screen-reader-only aside', () => {
    // The other half, and it is not implied by the first: `sr-only` keeps an
    // element in the accessibility tree, so the assertion above passes with the
    // badge invisible. The returning player this exists for is usually sighted
    // and scanning five buttons — that is the whole affordance.
    //
    // Asserted on the RENDERED element rather than on file text, so it cannot
    // go vacuous: getByText throws when there is nothing with that text at all.
    render(createElement(LastUsedBadge, null))
    expect(screen.getByText('Last used').className).not.toMatch(/sr-only/)
  })
})
