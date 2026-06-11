import type { NodeView, Point, SceneSource } from '../types'
import { nodeRenderRect, pointInRect } from '../types'

/**
 * Topmost visible node at a world point, or null. Topmost = last in paint
 * order, so we walk the paint list backwards over the spatial candidates.
 */
export function hitTestNode(scene: SceneSource, worldPt: Point, slop = 2): NodeView | null {
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
    const n = scene.nodes.get(id)
    if (!n || !n.visible) continue
    if (pointInRect(worldPt, nodeRenderRect(n), slop)) return n
  }
  return null
}
