// constants/brand.ts — Single source of truth for app identity & ownership.
//
// DESIGN: Rename the creator in ONE place (`owner`) and it propagates everywhere the
// app asserts ownership — the site footer and the in-app Licenses page both read from
// here, so there is no second spot to forget. Keeps legal/branding copy D.R.Y.
//
// NOTE: the root-level `LICENSE` file is a static legal document and cannot import this
// module, so it holds the owner name literally. It is the ONLY place outside this file
// that must be edited by hand when the owner changes.

export const BRAND = {
  /** Display name of the app. */
  appName: 'Gridlock Chess',
  /** Wordmark with the common-law trademark mark (™). */
  appNameTrademarked: 'Gridlock Chess\u2122',
  /** Canonical owner / creator — THE one place to rename. Indie developer, not a company. */
  owner: 'tao-heed',
  /**
   * Creator's public profile, used for the "Built by" credit link.
   * Left as '#' (renders as plain, unlinked text) until a real URL is provided —
   * swap in e.g. 'https://github.com/1khl45' to make the credit a link.
   */
  ownerUrl: '#',
  /** Year the project started; copyright auto-spans start→current year. */
  startYear: 2026,
} as const;
