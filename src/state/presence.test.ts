// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { PresenceStore, colorForClient } from './presence'

const shape = (over: object = {}) => ({
  user: { name: 'Calm Otter', color: '#0D9488' },
  cursor: { x: 1, y: 2 },
  selection: ['n1'],
  editing: null,
  ...over,
})

describe('PresenceStore', () => {
  it('mirrors peers, selections and editing; excludes self', () => {
    const p = new PresenceStore()
    p.apply(new Map([[1, shape()], [2, shape({ editing: 'n9', selection: [] })]]), 2)
    expect(p.peers.size).toBe(1)
    expect(p.peers.get(1)!.user.name).toBe('Calm Otter')
    expect(p.selectedBy.get('n1')).toBe('#0D9488')
    expect(p.editingBy.has('n9')).toBe(false) // self is excluded entirely
  })

  it('bumps version on membership change, not on cursor moves', () => {
    const p = new PresenceStore()
    p.apply(new Map([[1, shape()]]), 99)
    const v1 = p.version
    p.apply(new Map([[1, shape({ cursor: { x: 50, y: 60 } })]]), 99)
    expect(p.version).toBe(v1) // cursor-only → no chrome re-render
    p.apply(new Map([[1, shape()], [2, shape()]]), 99)
    expect(p.version).toBe(v1 + 1) // join → bump
    p.apply(new Map([[2, shape()]]), 99)
    expect(p.version).toBe(v1 + 2) // leave → bump
  })

  it('fires repaint hook on every apply', () => {
    const p = new PresenceStore()
    let paints = 0
    p.onRepaint = () => paints++
    p.apply(new Map([[1, shape()]]), 99)
    p.apply(new Map([[1, shape({ cursor: { x: 5, y: 5 } })]]), 99)
    expect(paints).toBe(2)
  })

  it('assigns stable palette colors by client id', () => {
    expect(colorForClient(3)).toBe(colorForClient(3))
    expect(typeof colorForClient(123456)).toBe('string')
  })
})
