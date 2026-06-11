import type { Point } from '../types'
import type { TidyInput } from './tidyTree'
import { tidyLayout } from './tidyTree'

/**
 * Mindmap layout on top of the tidy tree (SPEC §6): both-sides roots with
 * mirrored left side, top-down option, collapsed subtrees contributing only
 * their own box, and manual-offset nodes anchored to their parent but
 * excluded from sibling packing.
 */

export interface SpacingTokens {
  levelGap: number
  siblingGap: number
  branchGap: number
  /** 0.6–1.6 multiplier on all three gaps */
  compactness: number
}

export const DEFAULT_SPACING: SpacingTokens = {
  levelGap: 56,
  siblingGap: 14,
  branchGap: 28,
  compactness: 1,
}

/** The minimal node data layout needs; satisfied by the mirror's NodeView. */
export interface LayoutNodeData {
  id: string
  width: number
  height: number
  childrenIds: string[]
  collapsed: boolean
  layout: 'auto' | 'manual'
  mx: number
  my: number
  side: 'left' | 'right' | null
  dir: 'right' | 'down' | 'both' | null
}

export type GetNode = (id: string) => LayoutNodeData | undefined

type Orientation = 'right' | 'left' | 'down'

interface PendingManual {
  id: string
  parentId: string
  orientation: Orientation
}

/**
 * Lay out one root's tree. Returns world CENTER positions for every node that
 * participates in layout (nodes hidden under a collapsed ancestor are
 * omitted). The root's own position is (root.mx, root.my) — roots use the
 * manual-offset fields as their absolute position. Manual-offset non-roots
 * sit at parentCenter + (mx, my) and their subtrees lay out around them.
 */
export function layoutMindmapRoot(
  rootId: string,
  get: GetNode,
  tokens: SpacingTokens = DEFAULT_SPACING,
): Map<string, Point> {
  const root = get(rootId)
  if (!root) return new Map()
  const k = tokens.compactness
  const opts = {
    levelGap: tokens.levelGap * k,
    siblingGap: tokens.siblingGap * k,
    branchGap: tokens.branchGap * k,
  }
  const out = new Map<string, Point>()
  const rootCenter: Point = { x: root.mx, y: root.my }
  out.set(rootId, rootCenter)

  // Manual-offset subtrees discovered while building inputs; each is laid out
  // as its own anchored tree afterwards (their parents have positions by then).
  const pending: PendingManual[] = []

  const layoutTree = (
    treeRoot: LayoutNodeData,
    children: LayoutNodeData[],
    center: Point,
    orientation: Orientation,
  ): void => {
    const down = orientation === 'down'

    const buildItem = (node: LayoutNodeData): TidyInput => {
      const kids: TidyInput[] = []
      if (!node.collapsed) {
        for (const cid of node.childrenIds) {
          const child = get(cid)
          if (!child) continue
          if (child.layout === 'manual') {
            pending.push({ id: cid, parentId: node.id, orientation })
          } else {
            kids.push(buildItem(child))
          }
        }
      }
      return down
        ? { id: node.id, w: node.height, h: node.width, children: kids }
        : { id: node.id, w: node.width, h: node.height, children: kids }
    }

    const rootKids: TidyInput[] = []
    if (!treeRoot.collapsed) {
      for (const c of children) {
        if (c.layout === 'manual') pending.push({ id: c.id, parentId: treeRoot.id, orientation })
        else rootKids.push(buildItem(c))
      }
    }
    const rootItem: TidyInput = down
      ? { id: treeRoot.id, w: treeRoot.height, h: treeRoot.width, children: rootKids }
      : { id: treeRoot.id, w: treeRoot.width, h: treeRoot.height, children: rootKids }

    const res = tidyLayout(rootItem, opts)

    // Convert tidy frame (leading-edge x, root-relative center y) to world centers.
    const apply = (item: TidyInput): void => {
      if (item.id !== treeRoot.id) {
        const node = get(item.id)!
        const tx = res.x.get(item.id)!
        const ty = res.y.get(item.id)!
        let cx: number
        let cy: number
        if (down) {
          // swapped axes: tidy x = vertical leading edge from the root's top
          const rootTop = center.y - treeRoot.height / 2
          cy = rootTop + tx + node.height / 2
          cx = center.x + ty
        } else {
          const rootLeft = center.x - treeRoot.width / 2
          const cxRight = rootLeft + tx + node.width / 2
          cx = orientation === 'left' ? 2 * center.x - cxRight : cxRight
          cy = center.y + ty
        }
        out.set(item.id, { x: cx, y: cy })
      }
      for (const c of item.children) apply(c)
    }
    apply(rootItem)
  }

  // Partition the root's children by side (dir 'both') or push all one way.
  const dir = root.dir ?? 'both'
  const allChildren = root.childrenIds.map(get).filter((c): c is LayoutNodeData => !!c)
  if (dir === 'both') {
    const rightKids = allChildren.filter((c) => (c.side ?? 'right') === 'right')
    const leftKids = allChildren.filter((c) => c.side === 'left')
    layoutTree(root, rightKids, rootCenter, 'right')
    layoutTree(root, leftKids, rootCenter, 'left')
  } else if (dir === 'down') {
    layoutTree(root, allChildren, rootCenter, 'down')
  } else {
    layoutTree(root, allChildren, rootCenter, 'right')
  }

  // Anchored manual subtrees (processing may reveal nested manual subtrees).
  while (pending.length > 0) {
    const p = pending.shift()!
    const node = get(p.id)
    const parentCenter = out.get(p.parentId)
    if (!node || !parentCenter) continue
    const anchor = { x: parentCenter.x + node.mx, y: parentCenter.y + node.my }
    const kids = node.collapsed
      ? []
      : node.childrenIds.map(get).filter((c): c is LayoutNodeData => !!c)
    out.set(p.id, anchor)
    layoutTree(node, kids, anchor, p.orientation)
  }

  return out
}

/**
 * Which side of the root a new depth-1 child should get to keep the map
 * balanced: the side whose subtrees sum to the smaller total height.
 */
export function pickBalancedSide(
  root: LayoutNodeData,
  get: GetNode,
  subtreeHeight: (id: string) => number,
): 'left' | 'right' {
  let leftH = 0
  let rightH = 0
  for (const cid of root.childrenIds) {
    const c = get(cid)
    if (!c) continue
    const h = subtreeHeight(cid)
    if (c.side === 'left') leftH += h
    else rightH += h
  }
  return rightH <= leftH ? 'right' : 'left'
}
