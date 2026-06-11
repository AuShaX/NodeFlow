import { describe, expect, it } from 'vitest'
import { SpatialIndex } from './spatialIndex'

describe('SpatialIndex', () => {
  it('finds entries whose cells intersect the query rect', () => {
    const idx = new SpatialIndex()
    idx.insert('a', { x: 0, y: 0, w: 100, h: 40 })
    idx.insert('b', { x: 5000, y: 5000, w: 100, h: 40 })
    const hits = idx.queryRect({ x: -10, y: -10, w: 200, h: 200 })
    expect(hits.has('a')).toBe(true)
    expect(hits.has('b')).toBe(false)
  })

  it('returns entries spanning multiple cells exactly once', () => {
    const idx = new SpatialIndex()
    idx.insert('wide', { x: -300, y: -300, w: 1200, h: 1200 })
    const hits = idx.queryRect({ x: 0, y: 0, w: 10, h: 10 })
    expect([...hits]).toEqual(['wide'])
  })

  it('update moves an entry between cells', () => {
    const idx = new SpatialIndex()
    idx.insert('n', { x: 0, y: 0, w: 50, h: 50 })
    idx.update('n', { x: 10000, y: 10000, w: 50, h: 50 })
    expect(idx.queryRect({ x: 0, y: 0, w: 100, h: 100 }).has('n')).toBe(false)
    expect(idx.queryRect({ x: 9990, y: 9990, w: 100, h: 100 }).has('n')).toBe(true)
  })

  it('remove deletes an entry', () => {
    const idx = new SpatialIndex()
    idx.insert('n', { x: 0, y: 0, w: 50, h: 50 })
    idx.remove('n')
    expect(idx.queryRect({ x: -100, y: -100, w: 300, h: 300 }).size).toBe(0)
    expect(idx.has('n')).toBe(false)
  })

  it('negative coordinates land in the right cells', () => {
    const idx = new SpatialIndex()
    idx.insert('neg', { x: -1000, y: -1000, w: 20, h: 20 })
    expect(idx.queryRect({ x: -1010, y: -1010, w: 40, h: 40 }).has('neg')).toBe(true)
    expect(idx.queryRect({ x: 0, y: 0, w: 40, h: 40 }).has('neg')).toBe(false)
  })
})
