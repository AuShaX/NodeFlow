/**
 * Cubic-bezier easing equivalent to CSS cubic-bezier(p1x, p1y, p2x, p2y).
 * Solves x(t) = progress for t via Newton-Raphson with a bisection fallback,
 * then evaluates y(t).
 */
export function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  // Polynomial coefficients for B(t) with B(0)=0, B(1)=1.
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx

  const solveT = (x: number): number => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x
      if (Math.abs(err) < 1e-6) return t
      const d = sampleDX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    // Bisection fallback for flat derivatives.
    let lo = 0
    let hi = 1
    t = x
    while (lo < hi) {
      const mid = (lo + hi) / 2
      const v = sampleX(mid)
      if (Math.abs(v - x) < 1e-6) return mid
      if (v < x) lo = mid + 1e-7
      else hi = mid - 1e-7
      t = mid
    }
    return t
  }

  return (progress: number): number => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    return sampleY(solveT(progress))
  }
}

/** The app-wide layout tween curve from SPEC §6. */
export const layoutEase = cubicBezier(0.25, 1, 0.4, 1)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
