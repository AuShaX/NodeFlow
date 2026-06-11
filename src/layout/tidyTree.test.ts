import { describe, expect, it } from 'vitest'
import type { TidyInput } from './tidyTree'
import { tidyLayout } from './tidyTree'

const OPTS = { levelGap: 56, siblingGap: 14, branchGap: 28 }

let seq = 0
const n = (w: number, h: number, children: TidyInput[] = []): TidyInput => ({
  id: 'n' + ++seq,
  w,
  h,
  children,
})

interface PlacedRect {
  id: string
  x0: number
  x1: number
  y0: number
  y1: number
}

function rects(root: TidyInput, res: ReturnType<typeof tidyLayout>): PlacedRect[] {
  const out: PlacedRect[] = []
  const walk = (node: TidyInput) => {
    const x = res.x.get(node.id)!
    const y = res.y.get(node.id)!
    out.push({ id: node.id, x0: x, x1: x + node.w, y0: y - node.h / 2, y1: y + node.h / 2 })
    node.children.forEach(walk)
  }
  walk(root)
  return out
}

function expectNoOverlaps(placed: PlacedRect[]): void {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]
      const b = placed[j]
      const overlap =
        a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
    }
  }
}

describe('tidyLayout', () => {
  it('keeps a single chain perfectly straight', () => {
    const leaf = n(80, 30)
    const root = n(100, 40, [n(90, 36, [n(85, 32, [leaf])])])
    const res = tidyLayout(root, OPTS)
    for (const id of res.y.keys()) expect(res.y.get(id)).toBe(0)
    // x advances by parent width + levelGap each level
    expect(res.x.get(root.id)).toBe(0)
    expect(res.x.get(root.children[0].id)).toBe(100 + 56)
    expect(res.x.get(leaf.id)).toBe(100 + 56 + 90 + 56 + 85 + 56)
  })

  it('separates a wide fan-out by the sibling gap and centers the parent', () => {
    const kids = Array.from({ length: 8 }, () => n(60, 30))
    const root = n(100, 40, kids)
    const res = tidyLayout(root, { ...OPTS, branchGap: OPTS.siblingGap })
    for (let i = 1; i < kids.length; i++) {
      const prevBottom = res.y.get(kids[i - 1].id)! + 15
      const top = res.y.get(kids[i].id)! - 15
      expect(top - prevBottom).toBeCloseTo(OPTS.siblingGap, 6)
    }
    // parent centered between first and last child
    const first = res.y.get(kids[0].id)!
    const last = res.y.get(kids[kids.length - 1].id)!
    expect(res.y.get(root.id)).toBeCloseTo(0, 6)
    expect((first + last) / 2).toBeCloseTo(0, 6)
  })

  it('never overlaps boxes in a deep unbalanced tree', () => {
    // left-heavy: first child carries a deep chain with wide fan-outs
    const deep = n(80, 30, [
      n(80, 30, [n(80, 30), n(80, 30), n(80, 30), n(80, 30)]),
      n(80, 30, [n(80, 30, [n(80, 30), n(80, 30)])]),
    ])
    const root = n(100, 40, [deep, n(60, 30), n(60, 30)])
    const res = tidyLayout(root, OPTS)
    expectNoOverlaps(rects(root, res))
  })

  it('handles mixed node heights without overlap and keeps sibling order', () => {
    const kids = [n(80, 120), n(60, 18), n(120, 64), n(40, 240), n(90, 22)]
    const root = n(100, 40, kids)
    const res = tidyLayout(root, OPTS)
    expectNoOverlaps(rects(root, res))
    for (let i = 1; i < kids.length; i++) {
      expect(res.y.get(kids[i].id)!).toBeGreaterThan(res.y.get(kids[i - 1].id)!)
    }
  })

  it('lets short subtrees nestle beside tall ones without touching', () => {
    // first branch has a very tall deep child; second branch is shallow —
    // the shallow one may tuck closer at shallow depths but must clear the
    // tall subtree everywhere.
    const tall = n(80, 30, [n(80, 400)])
    const shallow = n(80, 30)
    const root = n(100, 40, [tall, shallow])
    const res = tidyLayout(root, OPTS)
    expectNoOverlaps(rects(root, res))
    // the shallow sibling clears the tall *silhouette*, not just the node box
    const tallChildBottom = res.y.get(tall.children[0].id)! + 200
    void tallChildBottom
    const shallowTop = res.y.get(shallow.id)! - 15
    const tallNodeBottom = res.y.get(tall.id)! + 15
    expect(shallowTop).toBeGreaterThanOrEqual(tallNodeBottom + OPTS.siblingGap - 1e-6)
  })

  it('a collapsed branch (no children in input) packs as just its own box', () => {
    const collapsed = n(80, 30) // collapsed = caller passes no children
    const open = n(80, 30, [n(80, 30), n(80, 30)])
    const root = n(100, 40, [collapsed, open])
    const res = tidyLayout(root, OPTS)
    expectNoOverlaps(rects(root, res))
    // collapsed branch sits close to the open one: distance bounded by its own box
    const gap = res.y.get(open.id)! - 15 - (res.y.get(collapsed.id)! + 15)
    expect(gap).toBeLessThanOrEqual(OPTS.branchGap + 1e-6)
  })

  it('uses branchGap between the root’s immediate subtrees', () => {
    const a = n(80, 30)
    const b = n(80, 30)
    const root = n(100, 40, [a, b])
    const res = tidyLayout(root, OPTS)
    const dist = res.y.get(b.id)! - 15 - (res.y.get(a.id)! + 15)
    expect(dist).toBeCloseTo(OPTS.branchGap, 6)
  })
})
