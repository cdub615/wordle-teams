# Shared structure notes (not a template engine — the three files are standalone)

Each launch email is ONE self-contained HTML file. There is no build step, no npm
dependency and no React. Resend Broadcasts accept raw HTML, so these paste in as-is.

They deliberately share a skeleton so a change to one is easy to mirror:

  1  preheader        hidden inbox-preview line
  2  masthead         wordmark + a five-tile Wordle row spelling the segment's word
  3  hero             h1 + lead paragraph
  4  cards            2-3 feature blocks, copy lifted from tested product sources
  5  cta              bulletproof button -> https://wordleteams.com/app
  6  reassurance      "nothing moved" strip (A and B only)
  7  pro line         ONE quiet line (A and B only; absent from C entirely)
  8  LEGAL NOTICE     the terms-change line. REQUIRED IN ALL THREE. Never delete.
  9  PWA BLOCK        comment-delimited, DELETE-BY-DEFAULT. See below.
 10  footer           why-you-got-this, postal address, unsubscribe

## Merge tags (Resend Broadcast syntax)

  {{{FIRST_NAME|there}}}        pipe-fallback, because 0 of the 163 nameless rows
                                have a name and some of the 401 may not either
  {{{RESEND_UNSUBSCRIBE_URL}}}  required; Resend rejects a broadcast without it

## Copy provenance — every product claim traces to a tested source

  team chat / reminders     src/lib/free-includes.ts
  benchmark / team fact     src/lib/free-includes.ts
  the three steps           src/components/home/marketing-copy.ts  HOW_IT_WORKS
  "two teams are free"      convex/lib/teamLimits.ts via marketing-copy.ts
  Pro price                 src/lib/plans.ts  PRO_PRICE_LINE  ($49.99/year)
  Pro benefits              src/lib/pro-benefits.ts

No sentence in these files invents a capability. If a claim here and the product
disagree, the product is right and the email is the bug.

## The PWA block

Every file carries this pair of markers:

  <!-- PWA-BLOCK:START  DELETE THIS WHOLE BLOCK UNLESS RUNBOOK 5.2 FAILED -->
  ...
  <!-- PWA-BLOCK:END -->

The block is written OUT, in full, in the state where it IS needed. The expected
outcome is that it is deleted. That is the point: at send time the decision is a
deletion, not composition under pressure. See docs/runbooks/launch-email-send.md.
