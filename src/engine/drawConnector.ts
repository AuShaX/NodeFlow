import type { ConnectorStyle, NodeView, Point, Rect } from '../types'

/**
 * Tree connectors per SPEC §7. Always computed from current animated
 * positions (renderX/renderY) so they are correct mid-tween and mid-drag.
 */

export type ConnectorAxis = 'h' | 'v'

export interface ConnectorGeom {
  /** start anchor (on parent edge) */
  p: Point
  /** end anchor (on child edge) */
  c: Point
  axis: ConnectorAxis
  /** +1 when the child sits in the positive primary-axis direction */
  sign: 1 | -1
}

/** Anchor points: parent edge midpoint facing the child, child edge midpoint facing the parent. */
export function connectorGeom(
  parent: NodeView,
  child: NodeView,
  axis: ConnectorAxis,
): ConnectorGeom {
  if (axis === 'v') {
    return {
      p: { x: parent.renderX, y: parent.renderY + parent.height / 2 },
      c: { x: child.renderX, y: child.renderY - child.height / 2 },
      axis,
      sign: 1,
    }
  }
  if (child.renderX >= parent.renderX) {
    return {
      p: { x: parent.renderX + parent.width / 2, y: parent.renderY },
      c: { x: child.renderX - child.width / 2, y: child.renderY },
      axis,
      sign: 1,
    }
  }
  return {
    p: { x: parent.renderX - parent.width / 2, y: parent.renderY },
    c: { x: child.renderX + child.width / 2, y: child.renderY },
    axis,
    sign: -1,
  }
}

/** Cubic Bézier control points for the curved style (horizontal tangents at both ends). */
export function curvedControls(g: ConnectorGeom): [Point, Point] {
  if (g.axis === 'h') {
    const dx = Math.max(24, Math.abs(g.c.x - g.p.x) * 0.45) * g.sign
    return [
      { x: g.p.x + dx, y: g.p.y },
      { x: g.c.x - dx, y: g.c.y },
    ]
  }
  const dy = Math.max(24, Math.abs(g.c.y - g.p.y) * 0.45)
  return [
    { x: g.p.x, y: g.p.y + dy },
    { x: g.c.x, y: g.c.y - dy },
  ]
}

export function buildConnectorPath(
  ctx: CanvasRenderingContext2D,
  g: ConnectorGeom,
  style: ConnectorStyle,
): void {
  ctx.beginPath()
  ctx.moveTo(g.p.x, g.p.y)
  if (style === 'curved') {
    const [c1, c2] = curvedControls(g)
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, g.c.x, g.c.y)
    return
  }
  // Elbow: single bend at the midpoint of the primary axis, rounded corners.
  if (g.axis === 'h') {
    const midX = (g.p.x + g.c.x) / 2
    const r = Math.min(10, Math.abs(g.c.x - g.p.x) / 2, Math.abs(g.c.y - g.p.y) / 2)
    ctx.arcTo(midX, g.p.y, midX, g.c.y, r)
    ctx.arcTo(midX, g.c.y, g.c.x, g.c.y, r)
    ctx.lineTo(g.c.x, g.c.y)
  } else {
    const midY = (g.p.y + g.c.y) / 2
    const r = Math.min(10, Math.abs(g.c.y - g.p.y) / 2, Math.abs(g.c.x - g.p.x) / 2)
    ctx.arcTo(g.p.x, midY, g.c.x, midY, r)
    ctx.arcTo(g.c.x, midY, g.c.x, g.c.y, r)
    ctx.lineTo(g.c.x, g.c.y)
  }
}

/** Paint the parent→child tree edge. Assumes world-space ctx. */
export function drawTreeConnector(
  ctx: CanvasRenderingContext2D,
  parent: NodeView,
  child: NodeView,
  axis: ConnectorAxis,
  style: ConnectorStyle,
  alphaMul = 1,
): void {
  const alpha = child.renderAlpha * parent.renderAlpha * alphaMul
  if (alpha <= 0.01) return
  const g = connectorGeom(parent, child, axis)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = child.effectiveColor
  ctx.lineWidth = child.depth === 1 ? 2.5 : 2
  ctx.lineCap = 'round'
  buildConnectorPath(ctx, g, style)
  ctx.stroke()
  ctx.restore()
}

/** Loose world-space bounds of an edge, for culling. */
export function connectorBounds(parent: NodeView, child: NodeView): Rect {
  const x = Math.min(parent.renderX, child.renderX)
  const y = Math.min(parent.renderY, child.renderY)
  const margin = 40
  return {
    x: x - margin,
    y: y - margin,
    w: Math.abs(parent.renderX - child.renderX) + 2 * margin,
    h: Math.abs(parent.renderY - child.renderY) + 2 * margin,
  }
}

/** Sample a connector as a polyline (used by hit-testing). */
export function sampleConnector(g: ConnectorGeom, style: ConnectorStyle, samples = 24): Point[] {
  const pts: Point[] = []
  if (style === 'curved') {
    const [c1, c2] = curvedControls(g)
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const mt = 1 - t
      pts.push({
        x:
          mt * mt * mt * g.p.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * g.c.x,
        y:
          mt * mt * mt * g.p.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * g.c.y,
      })
    }
    return pts
  }
  if (g.axis === 'h') {
    const midX = (g.p.x + g.c.x) / 2
    pts.push(g.p, { x: midX, y: g.p.y }, { x: midX, y: g.c.y }, g.c)
  } else {
    const midY = (g.p.y + g.c.y) / 2
    pts.push(g.p, { x: g.p.x, y: midY }, { x: g.c.x, y: midY }, g.c)
  }
  return pts
}
