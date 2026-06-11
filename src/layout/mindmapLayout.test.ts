import { describe, expect, it } from 'vitest'
import type { LayoutNodeData } from './mindmapLayout'
import { DEFAULT_SPACING, layoutMindmapRoot, pickBalancedSide } from './mindmapLayout'

interface Spec {
  id: string
  w?: number
  h?: number
  collapsed?: boolean
  layout?: 'auto' | 'manual'
  mx?: number
  my?: number
  side?: 'left' | 'right'
  dir?: 'right' | 'down' | 'both'
  children?: Spec[]
}

function build(spec: Spec): Map<string, LayoutNodeData> {
  const map = new Map<string, LayoutNodeData>()
  const walk = (s: Spec): void => {
    map.set(s.id, {
      id: s.id,
      width: s.w ?? 80,
      height: s.h ?? 30,
      childrenIds: (s.children ?? []).map((c) => c.id),
      collapsed: s.collapsed ?? false,
      layout: s.layout ?? 'auto',
      mx: s.mx ?? 0,
      my: s.my ?? 0,
      side: s.side ?? null,
      dir: s.dir ?? null,
    })
    for (const c of s.children ?? []) walk(c)
  }
  walk(spec)
  return map
}

const G = DEFAULT_SPACING

describe('layoutMindmapRoot', () => {
  it('places right-side children to the right, left-side mirrored', () => {
    const nodes = build({
      id: 'root',
      w: 120,
      h: 40,
      dir: 'both',
      children: [
        { id: 'r1', side: 'right' },
        { id: 'l1', side: 'left' },
      ],
    })
    const pos = layoutMindmapRoot('root', (id) => nodes.get(id))
    expect(pos.get('root')).toEqual({ x: 0, y: 0 })
    // right child: left edge at rootRight + levelGap
    expect(pos.get('r1')!.x - 40).toBeCloseTo(60 + G.levelGap, 6)
    // left child mirrored: right edge at rootLeft − levelGap
    expect(pos.get('l1')!.x + 40).toBeCloseTo(-60 - G.levelGap, 6)
    expect(pos.get('r1')!.y).toBeCloseTo(0, 6)
    expect(pos.get('l1')!.y).toBeCloseTo(0, 6)
  })

  it('roots use mx/my as absolute position', () => {
    const nodes = build({ id: 'root', mx: 500, my: -200, children: [{ id: 'c', side: 'right' }] })
    const pos = layoutMindmapRoot('root', (id) => nodes.get(id))
    expect(pos.get('root')).toEqual({ x: 500, y: -200 })
    expect(pos.get('c')!.y).toBeCloseTo(-200, 6)
  })

  it('omits nodes hidden under a collapsed ancestor', () => {
    const nodes = build({
      id: 'root',
      children: [
        {
          id: 'a',
          side: 'right',
          collapsed: true,
          children: [{ id: 'hidden1', children: [{ id: 'hidden2' }] }],
        },
        { id: 'b', side: 'right' },
      ],
    })
    const pos = layoutMindmapRoot('root', (id) => nodes.get(id))
    expect(pos.has('a')).toBe(true)
    expect(pos.has('b')).toBe(true)
    expect(pos.has('hidden1')).toBe(false)
    expect(pos.has('hidden2')).toBe(false)
  })

  it('dir:down stacks children below the root', () => {
    const nodes = build({
      id: 'root',
      w: 120,
      h: 40,
      dir: 'down',
      children: [{ id: 'a' }, { id: 'b' }],
    })
    const pos = layoutMindmapRoot('root', (id) => nodes.get(id))
    const a = pos.get('a')!
    const b = pos.get('b')!
    // both children's top edges sit at rootBottom + levelGap
    expect(a.y - 15).toBeCloseTo(20 + G.levelGap, 6)
    expect(b.y - 15).toBeCloseTo(20 + G.levelGap, 6)
    // they spread horizontally around the root with branchGap between boxes
    expect(a.x).toBeLessThan(b.x)
    expect(b.x - 40 - (a.x + 40)).toBeCloseTo(G.branchGap, 6)
  })

  it('manual nodes anchor at parentCenter + (mx,my) and do not push siblings', () => {
    const base = {
      id: 'root',
      w: 120,
      h: 40,
      children: [
        { id: 'a', side: 'right' as const },
        { id: 'm', side: 'right' as const, layout: 'manual' as const, mx: 300, my: 220 },
        { id: 'b', side: 'right' as const },
      ],
    }
    const nodes = build(base)
    const pos = layoutMindmapRoot('root', (id) => nodes.get(id))
    expect(pos.get('m')).toEqual({ x: 300, y: 220 })
    // a and b pack as if m didn't exist: symmetric around the root
    expect(pos.get('a')!.y + pos.get('b')!.y).toBeCloseTo(0, 6)
    const gap = pos.get('b')!.y - 15 - (pos.get('a')!.y + 15)
    expect(gap).toBeCloseTo(G.branchGap, 6)
  })

  it('a manual node’s subtree lays out around its anchor', () => {
    const nodes = build({
      id: 'root',
      w: 120,
      h: 40,
      children: [
        {
          id: 'm',
          side: 'right',
          layout: 'manual',
          mx: 400,
          my: 0,
          children: [{ id: 'mc1' }, { id: 'mc2' }],
        },
      ],
    })
    const pos = layoutMindmapRoot('root', (id) => nodes.get(id))
    const m = pos.get('m')!
    const c1 = pos.get('mc1')!
    const c2 = pos.get('mc2')!
    expect(c1.x - 40).toBeCloseTo(m.x + 40 + G.levelGap, 6)
    expect((c1.y + c2.y) / 2).toBeCloseTo(m.y, 6)
  })
})

describe('pickBalancedSide', () => {
  it('assigns to the side with the smaller total height', () => {
    const nodes = build({
      id: 'root',
      children: [
        { id: 'r1', side: 'right' },
        { id: 'r2', side: 'right' },
        { id: 'l1', side: 'left' },
      ],
    })
    const heights = new Map([
      ['r1', 100],
      ['r2', 60],
      ['l1', 80],
    ])
    const side = pickBalancedSide(
      nodes.get('root')!,
      (id) => nodes.get(id),
      (id) => heights.get(id) ?? 0,
    )
    expect(side).toBe('left') // right = 160, left = 80
  })

  it('prefers right on a fresh root', () => {
    const nodes = build({ id: 'root' })
    const side = pickBalancedSide(
      nodes.get('root')!,
      (id) => nodes.get(id),
      () => 0,
    )
    expect(side).toBe('right')
  })
})
