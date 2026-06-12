/**
 * Subsequence fuzzy match (case-insensitive). Score favors substring runs,
 * word-boundary starts and early matches; returns matched char indices for
 * highlighting, or null when the query isn't a subsequence.
 */
export function fuzzyMatch(
  text: string,
  query: string,
): { score: number; indices: ReadonlySet<number> } | null {
  if (query === '') return null
  const t = text.toLowerCase()
  // exact substring: strongest signal
  const at = t.indexOf(query)
  if (at >= 0) {
    const indices = new Set<number>()
    for (let i = 0; i < query.length; i++) indices.add(at + i)
    const wordStart = at === 0 || /[\s\-_/(]/.test(t[at - 1])
    return { score: 1000 + (wordStart ? 100 : 0) - at - t.length * 0.01, indices }
  }
  // scattered subsequence
  const indices = new Set<number>()
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of query) {
    if (ch === ' ') continue
    let found = -1
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti
        break
      }
      ti++
    }
    if (found < 0) return null
    indices.add(found)
    const boundary = found === 0 || /[\s\-_/(]/.test(t[found - 1])
    score += 10 + (boundary ? 8 : 0) + (found === prev + 1 ? 6 : 0) - found * 0.05
    prev = found
    ti = found + 1
  }
  return { score: score - t.length * 0.01, indices }
}
