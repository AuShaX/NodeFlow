/**
 * Fractional ordering keys (SPEC §5): sibling order is a string; inserting
 * between two siblings is a single-field write of the lexicographic midpoint.
 * Base-62 alphabet in ASCII order so plain string comparison sorts correctly.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

const digitAt = (key: string, i: number, pad: number): number =>
  i < key.length ? DIGITS.indexOf(key[i]) : pad

/**
 * A key strictly between `a` and `b`. Pass null for the open ends:
 * keyBetween(null, null) → first key; (a, null) → after a; (null, b) → before b.
 */
export function keyBetween(a: string | null, b: string | null): string {
  const lo = a ?? ''
  const hi = b ?? ''
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: "${a}" must sort before "${b}"`)
  }
  let result = ''
  for (let i = 0; ; i++) {
    const da = digitAt(lo, i, 0) // pad a with the implicit minimum
    const db = b === null ? BASE : digitAt(hi, i, 0) // pad b with one past max
    if (da === db) {
      result += DIGITS[da]
      continue
    }
    if (db - da > 1) {
      return result + DIGITS[Math.floor((da + db) / 2)]
    }
    // Adjacent digits: keep a's digit, then find room above the rest of a.
    result += DIGITS[da]
    for (i++; ; i++) {
      const rest = digitAt(lo, i, 0)
      if (rest === BASE - 1) {
        result += DIGITS[BASE - 1]
        continue
      }
      return result + DIGITS[Math.ceil((rest + BASE) / 2)]
    }
  }
}

/** n evenly spread keys for bulk insertion between a and b. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return []
  if (n === 1) return [keyBetween(a, b)]
  const mid = Math.floor(n / 2)
  const m = keyBetween(a, b)
  return [...keysBetween(a, m, mid), m, ...keysBetween(m, b, n - mid - 1)]
}
