/**
 * What a word box keeps of its input: letters only, at most five, lower-cased.
 * NFKD folds fullwidth (ＣＲＡＮＥ) to ASCII and splits accents off (cráne →
 * cra + ◌́ + ne); the combining marks are then dropped, so an accent is FOLDED
 * rather than losing its letter. Everything else (spaces, zero-width, digits)
 * is dropped. Shared by WordPicker and the standings' "Find a group".
 */
export const lettersOf = (raw: string): string =>
  raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z]/gi, '')
    .slice(0, 5)
    .toLowerCase()
