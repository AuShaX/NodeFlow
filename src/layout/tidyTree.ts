/**
 * Variable-node-size tidy tree (SPEC §6). Pure functions, no DOM.
 *
 * Normalized frame: the primary axis is x growing right, the cross axis is y.
 * Children stack along y to the right of their parent; child left edges align
 * at parent-right + levelGap. Subtree packing uses full silhouette contours so
 * tall subtrees never overlap, and shorter subtrees can nestle under longer
 * ones (flextree-style union contours).
 *
 * Output: x = leading-edge position (root at 0), y = cross-axis center
 * relative to the root's center (root at 0). Callers mirror/swap axes for
 * left-side and top-down layouts.
 */

export interface TidyInput {
  id: string
  /** primary-axis size */
  w: number
  /** cross-axis size */
  h: number
  children: TidyInput[]
}

export interface TidyOptions {
  levelGap: number
  siblingGap: number
  /** gap between the layout root's immediate child subtrees (default: siblingGap) */
  branchGap?: number
}

export interface TidyResult {
  x: Map<string, number>
  y: Map<string, number>
}

/** Piecewise-constant boundary: y over [x0, x1), segments contiguous & ordered. */
interface Seg {
  x0: number
  x1: number
  y: number
}

interface Frame {
  /** upper silhouette (min y) in the local frame (node center y = 0) */
  top: Seg[]
  /** lower silhouette (max y) */
  bottom: Seg[]
  /** cross-axis offset of each child's center relative to this node's center */
  childRel: number[]
}

const EPS = 1e-9

/** Pointwise min/max union of two segment lists (either may extend further in x). */
function mergeContours(a: Seg[], b: Seg[], pickMin: boolean): Seg[] {
  if (a.length === 0) return b.slice()
  if (b.length === 0) return a.slice()
  const xs: number[] = []
  for (const s of a) {
    xs.push(s.x0, s.x1)
  }
  for (const s of b) {
    xs.push(s.x0, s.x1)
  }
  xs.sort((p, q) => p - q)
  const out: Seg[] = []
  let ai = 0
  let bi = 0
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    if (x1 - x0 < EPS) continue
    const mid = (x0 + x1) / 2
    while (ai < a.length && a[ai].x1 <= mid) ai++
    while (bi < b.length && b[bi].x1 <= mid) bi++
    const av = ai < a.length && a[ai].x0 <= mid ? a[ai].y : undefined
    const bv = bi < b.length && b[bi].x0 <= mid ? b[bi].y : undefined
    let y: number
    if (av === undefined && bv === undefined) continue
    else if (av === undefined) y = bv!
    else if (bv === undefined) y = av
    else y = pickMin ? Math.min(av, bv) : Math.max(av, bv)
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - y) < EPS && Math.abs(last.x1 - x0) < EPS) last.x1 = x1
    else out.push({ x0, x1, y })
  }
  return out
}

/** Fill x-gaps (e.g. the levelGap band) with the more extreme neighbor value. */
function bridgeGaps(segs: Seg[], pickMin: boolean): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && s.x0 - last.x1 > EPS) {
      out.push({
        x0: last.x1,
        x1: s.x0,
        y: pickMin ? Math.min(last.y, s.y) : Math.max(last.y, s.y),
      })
    }
    out.push({ ...s })
  }
  return out
}

const shift = (segs: Seg[], dy: number): Seg[] =>
  segs.map((s) => ({ x0: s.x0, x1: s.x1, y: s.y + dy }))

/**
 * Minimal cross-axis offset for `top` so it clears `bottom` by `gap`
 * everywhere they overlap in x.
 */
function requiredOffset(bottom: Seg[], top: Seg[], gap: number): number {
  let off = -Infinity
  let bi = 0
  for (const t of top) {
    while (bi < bottom.length && bottom[bi].x1 <= t.x0 + EPS) bi++
    let bj = bi
    while (bj < bottom.length && bottom[bj].x0 < t.x1 - EPS) {
      off = Math.max(off, bottom[bj].y + gap - t.y)
      bj++
    }
  }
  return off === -Infinity ? 0 : off
}

export function tidyLayout(root: TidyInput, opts: TidyOptions): TidyResult {
  const x = new Map<string, number>()
  const y = new Map<string, number>()

  // First pass: x is fixed by the parent chain alone.
  const assignX = (node: TidyInput, px: number): void => {
    x.set(node.id, px)
    const childX = px + node.w + opts.levelGap
    for (const c of node.children) assignX(c, childX)
  }
  assignX(root, 0)

  // Second pass: bottom-up contour packing.
  const frames = new Map<string, Frame>()
  const solve = (node: TidyInput, depth: number): Frame => {
    const nx = x.get(node.id)!
    const box: Seg[] = [{ x0: nx, x1: nx + node.w, y: 0 }]
    const boxTop = shift(box, -node.h / 2)
    const boxBottom = shift(box, node.h / 2)
    if (node.children.length === 0) {
      const f: Frame = { top: boxTop, bottom: boxBottom, childRel: [] }
      frames.set(node.id, f)
      return f
    }

    const gap = depth === 0 ? (opts.branchGap ?? opts.siblingGap) : opts.siblingGap
    const childFrames = node.children.map((c) => solve(c, depth + 1))

    // Pack children downward: child 0 at offset 0, each next pushed below the
    // accumulated silhouette of everything placed so far.
    const offsets: number[] = [0]
    let accTop = childFrames[0].top
    let accBottom = childFrames[0].bottom
    for (let i = 1; i < childFrames.length; i++) {
      const o = requiredOffset(accBottom, childFrames[i].top, gap)
      offsets.push(o)
      accTop = mergeContours(accTop, shift(childFrames[i].top, o), true)
      accBottom = mergeContours(accBottom, shift(childFrames[i].bottom, o), false)
    }

    // Center the parent between its first and last child.
    const center = (offsets[0] + offsets[offsets.length - 1]) / 2
    const childRel = offsets.map((o) => o - center)

    let top = mergeContours(boxTop, shift(accTop, -center), true)
    let bottom = mergeContours(boxBottom, shift(accBottom, -center), false)
    top = bridgeGaps(top, true)
    bottom = bridgeGaps(bottom, false)

    const f: Frame = { top, bottom, childRel }
    frames.set(node.id, f)
    return f
  }
  solve(root, 0)

  // Third pass: accumulate relative offsets into absolute cross positions.
  const place = (node: TidyInput, cy: number): void => {
    y.set(node.id, cy)
    const f = frames.get(node.id)!
    node.children.forEach((c, i) => place(c, cy + f.childRel[i]))
  }
  place(root, 0)

  return { x, y }
}
