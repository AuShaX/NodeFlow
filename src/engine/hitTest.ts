import type { LinkView, NodeView, Point, SceneSource } from '../types'
import { nodeRenderRect, pointInRect, rectsIntersect } from '../types'
import { bezierPoint, crossLinkBounds, crossLinkGeom } from './drawConnector'

/**
 * Topmost visible node at a world point, or null. Topmost = last in paint
 * order, so we walk the paint list backwards over the spatial candidates.
 */
export function hitTestNode(
  scene: SceneSource,
  worldPt: Point,
  slop = 2,
  exclude?: ReadonlySet<string>,
): NodeView | null {
  const candidates = scene.spatial.queryRect({
    x: worldPt.x - slop,
    y: worldPt.y - slop,
    w: slop * 2,
    h: slop * 2,
  })
  if (candidates.size === 0) return null
  const list = scene.paintList
  for (let i = list.length - 1; i >= 0; i--) {
    const id = list[i]
    if (!candidates.has(id)) continue
    if (exclude?.has(id)) continue
    const n = scene.nodes.get(id)
    if (!n || !n.visible) continue
    if (pointInRect(worldPt, nodeRenderRect(n), slop)) return n
  }
  return null
}

/**
 * Cross-link under a world point: sample each candidate link's Bézier at 24
 * points, hit when the pointer is within 6 screen px of the polyline.
 */
export function hitTestLink(scene: SceneSource, worldPt: Point, zoom: number): LinkView | null {
  const tol = 6 / zoom
  const probe = { x: worldPt.x - tol, y: worldPt.y - tol, w: tol * 2, h: tol * 2 }
  for (const link of scene.links) {
    const a = scene.getAnyNode(link.fromId)
    const b = scene.getAnyNode(link.toId)
    if (!a || !b || !a.visible || !b.visible) continue
    if (!rectsIntersect(crossLinkBounds(a, b), probe)) continue
    const g = crossLinkGeom(a, b)
    let prev = g.p
    for (let i = 1; i <= 24; i++) {
      const cur = bezierPoint(g, i / 24)
      if (distToSegment(worldPt, prev, cur) <= tol) return link
      prev = cur
    }
  }
  return null
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

/** Nearest visible node to a world point within `radius`, by box distance. */
export function nearestNode(
  scene: SceneSource,
  worldPt: Point,
  radius: number,
  exclude?: ReadonlySet<string>,
): NodeView | null {
  const candidates = scene.spatial.queryRect({
    x: worldPt.x - radius,
    y: worldPt.y - radius,
    w: radius * 2,
    h: radius * 2,
  })
  let best: NodeView | null = null
  let bestDist = radius
  for (const id of candidates) {
    if (exclude?.has(id)) continue
    const n = scene.nodes.get(id)
    if (!n || !n.visible) continue
    const r = nodeRenderRect(n)
    const dx = Math.max(r.x - worldPt.x, 0, worldPt.x - (r.x + r.w))
    const dy = Math.max(r.y - worldPt.y, 0, worldPt.y - (r.y + r.h))
    const d = Math.hypot(dx, dy)
    if (d < bestDist) {
      bestDist = d
      best = n
    }
  }
  return best
}
