/**
 * Title selection helpers.
 *
 * A hard-coded title string is a bet that the data will never grow. Every
 * templated title on this site interpolates a project or chain name, and those
 * names have wildly different lengths — "Safe (Gnosis Safe)" is 18 characters,
 * "Blur" is four. A suffix that fits today overflows the moment someone adds a
 * long-named project, and Google truncates at roughly 60 characters.
 *
 * So instead of one title we give a preference-ordered list and let the longest
 * one that fits win. The fallback is always the bare, always-short first
 * variant, never a mid-word truncation.
 */

export const TITLE_MAX = 60;

/**
 * Return the first candidate that fits within `max`, else the shortest one.
 * Candidates are ordered most-descriptive-first.
 */
export function fitTitle(candidates: string[], max: number = TITLE_MAX): string {
  for (const c of candidates) {
    if (c.length <= max) return c;
  }
  // Nothing fits. Take the shortest rather than chopping a word in half.
  return candidates.reduce((a, b) => (b.length < a.length ? b : a));
}

/** Trim a description to `max` without cutting mid-word where avoidable. */
export function fitDescription(text: string, max: number = 160): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break on a space if the tail we would lose is short; otherwise the
  // description ends up noticeably shorter than it needed to be.
  const trimmed = lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[.,;:—–-]\s*$/, '')}…`;
}
