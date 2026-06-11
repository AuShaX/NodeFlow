import { describe, expect, it } from 'vitest'
import { cubicBezier, layoutEase } from './easing'

describe('cubicBezier', () => {
  it('hits the endpoints exactly', () => {
    const ease = cubicBezier(0.25, 1, 0.4, 1)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-0.5)).toBe(0)
    expect(ease(1.5)).toBe(1)
  })

  it('reproduces the identity for linear control points', () => {
    const linear = cubicBezier(0.25, 0.25, 0.75, 0.75)
    for (let t = 0; t <= 1.0001; t += 0.1) {
      expect(linear(t)).toBeCloseTo(Math.min(1, t), 4)
    }
  })

  it('matches a known css ease-out sample', () => {
    // cubic-bezier(0, 0, 0.58, 1): x(t) = 1.74t² − 0.74t³ = 0.5 at t ≈ 0.62566,
    // y(t) = 3t² − 2t³ ≈ 0.68455 (computed analytically)
    const easeOut = cubicBezier(0, 0, 0.58, 1)
    expect(easeOut(0.5)).toBeCloseTo(0.68455, 3)
  })

  it('layoutEase is monotonically non-decreasing', () => {
    let prev = 0
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = layoutEase(t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
})
