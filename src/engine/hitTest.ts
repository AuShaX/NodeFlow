import type { NodeView, Point, SceneSource } from '../types'
import { nodeRenderRect, pointInRect } from '../types'

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
