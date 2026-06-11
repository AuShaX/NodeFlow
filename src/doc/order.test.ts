import { describe, expect, it } from 'vitest'
import { keyBetween, keysBetween } from './order'

describe('keyBetween', () => {
  it('produces ordered keys for sequential appends', () => {
    let prev = keyBetween(null, null)
    for (let i = 0; i < 200; i++) {
      const next = keyBetween(prev, null)
      expect(next > prev).toBe(true)
      prev = next
    }
  })

  it('produces ordered keys for sequential prepends', () => {
    let next = keyBetween(null, null)
    for (let i = 0; i < 200; i++) {
      const prev = keyBetween(null, next)
      expect(prev < next).toBe(true)
      next = prev
    }
  })

  it('always returns a key strictly between the bounds', () => {
    let a = keyBetween(null, null)
    let b = keyBetween(a, null)
    // repeatedly split the same interval — worst case for key growth
    for (let i = 0; i < 100; i++) {
      const m = keyBetween(a, b)
      expect(m > a).toBe(true)
      expect(m < b).toBe(true)
      if (i % 2 === 0) a = m
      else b = m
    }
  })

  it('handles adjacent digit keys', () => {
    const m = keyBetween('a', 'b')
    expect(m > 'a').toBe(true)
    expect(m < 'b').toBe(true)
  })

  it('handles keys where one is a prefix of the other', () => {
    const m = keyBetween('a', 'a1')
    expect(m > 'a').toBe(true)
    expect(m < 'a1').toBe(true)
  })

  it('throws when a >= b', () => {
    expect(() => keyBetween('b', 'a')).toThrow()
    expect(() => keyBetween('a', 'a')).toThrow()
  })

  it('random interleaved inserts stay sorted and unique', () => {
    const keys = [keyBetween(null, null)]
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let i = 0; i < 500; i++) {
      const pos = Math.floor(rand() * (keys.length + 1))
      const a = pos > 0 ? keys[pos - 1] : null
      const b = pos < keys.length ? keys[pos] : null
      keys.splice(pos, 0, keyBetween(a, b))
    }
    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('keysBetween', () => {
  it('returns n ordered keys between the bounds', () => {
    const ks = keysBetween('A', 'B', 10)
    expect(ks.length).toBe(10)
    for (let i = 0; i < ks.length; i++) {
      expect(ks[i] > 'A').toBe(true)
      expect(ks[i] < 'B').toBe(true)
      if (i > 0) expect(ks[i] > ks[i - 1]).toBe(true)
    }
  })
})
