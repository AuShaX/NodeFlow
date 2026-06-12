import type { ConnectorStyle, LinkView, NodeView, Point, Rect } from '../types'
import { COLORS, FONT_STACK, resolveNodeColor } from '../theme'

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
  ctx.strokeStyle = resolveNodeColor(child.effectiveColor)
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

// ----------------------------------------------------------- cross-links

export interface CrossLinkGeom {
  p: Point
  c: Point
  cp1: Point
  cp2: Point
}

/**
 * Point on a node's border along the ray from its center toward `toward`,
 * plus that edge's outward normal. Used to anchor cross-links on the nearest
 * edges of the two nodes.
 */
export function anchorOnBox(n: NodeView, toward: Point): { point: Point; normal: Point } {
  const dx = toward.x - n.renderX
  const dy = toward.y - n.renderY
  const hw = n.width / 2
  const hh = n.height / 2
  if (dx === 0 && dy === 0)
    return { point: { x: n.renderX + hw, y: n.renderY }, normal: { x: 1, y: 0 } }
  // scale the direction so it touches the box border
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  const px = n.renderX + dx * s
  const py = n.renderY + dy * s
  // normal of the edge we hit
  const normal: Point = sx < sy ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
  return { point: { x: px, y: py }, normal }
}

/** Bézier between the nearest edges of two nodes, leaving along edge normals. */
export function crossLinkGeom(a: NodeView, b: NodeView): CrossLinkGeom {
  const pa = anchorOnBox(a, { x: b.renderX, y: b.renderY })
  const pb = anchorOnBox(b, { x: a.renderX, y: a.renderY })
  const dist = Math.hypot(pb.point.x - pa.point.x, pb.point.y - pa.point.y)
  const reach = Math.max(24, dist * 0.35)
  return {
    p: pa.point,
    c: pb.point,
    cp1: { x: pa.point.x + pa.normal.x * reach, y: pa.point.y + pa.normal.y * reach },
    cp2: { x: pb.point.x + pb.normal.x * reach, y: pb.point.y + pb.normal.y * reach },
  }
}

export const bezierPoint = (g: CrossLinkGeom, t: number): Point => {
  const mt = 1 - t
  return {
    x: mt ** 3 * g.p.x + 3 * mt * mt * t * g.cp1.x + 3 * mt * t * t * g.cp2.x + t ** 3 * g.c.x,
    y: mt ** 3 * g.p.y + 3 * mt * mt * t * g.cp1.y + 3 * mt * t * t * g.cp2.y + t ** 3 * g.c.y,
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  from: Point,
  color: string,
): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const size = 8
  ctx.save()
  ctx.translate(tip.x, tip.y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size, -size * 0.45)
  ctx.lineTo(-size, size * 0.45)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

export interface CrossLinkDrawState {
  zoom: number
  selected: boolean
  /** label hidden while the inline editor is open */
  hideLabel: boolean
}

/** Paint a cross-link between two nodes (world-space ctx). */
export function drawCrossLink(
  ctx: CanvasRenderingContext2D,
  a: NodeView,
  b: NodeView,
  link: LinkView,
  s: CrossLinkDrawState,
): void {
  const alpha = a.renderAlpha * b.renderAlpha
  if (alpha <= 0.01) return
  const g = crossLinkGeom(a, b)
  const color = COLORS.muted
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = s.selected ? COLORS.accent : color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  if (link.style === 'dashed') ctx.setLineDash([7, 5])
  ctx.beginPath()
  ctx.moveTo(g.p.x, g.p.y)
  ctx.bezierCurveTo(g.cp1.x, g.cp1.y, g.cp2.x, g.cp2.y, g.c.x, g.c.y)
  ctx.stroke()
  ctx.setLineDash([])

  const arrowColor = s.selected ? COLORS.accent : color
  if (link.arrow === 'end' || link.arrow === 'both') {
    drawArrowhead(ctx, g.c, bezierPoint(g, 0.92), arrowColor)
  }
  if (link.arrow === 'both') {
    drawArrowhead(ctx, g.p, bezierPoint(g, 0.08), arrowColor)
  }

  if (link.label && !s.hideLabel && s.zoom >= 0.25) {
    const mid = bezierPoint(g, 0.5)
    ctx.font = `500 11px ${FONT_STACK}`
    const w = ctx.measureText(link.label).width
    const padX = 7
    const padY = 4
    ctx.beginPath()
    ctx.roundRect(mid.x - w / 2 - padX, mid.y - 9 - padY + 2, w + 2 * padX, 18 + 2 * padY - 4, 9)
    ctx.fillStyle = COLORS.surface
    ctx.fill()
    ctx.strokeStyle = s.selected ? COLORS.accent : COLORS.border
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = s.selected ? COLORS.accent : COLORS.muted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(link.label, mid.x, mid.y + 0.5)
  }
  ctx.restore()
}

/** Midpoint of a cross-link (label anchor, used by the inline label editor). */
export function crossLinkMidpoint(a: NodeView, b: NodeView): Point {
  return bezierPoint(crossLinkGeom(a, b), 0.5)
}

/** Loose bounds for culling a cross-link. */
export function crossLinkBounds(a: NodeView, b: NodeView): Rect {
  const x = Math.min(a.renderX, b.renderX)
  const y = Math.min(a.renderY, b.renderY)
  const margin = 80
  return {
    x: x - margin,
    y: y - margin,
    w: Math.abs(a.renderX - b.renderX) + 2 * margin,
    h: Math.abs(a.renderY - b.renderY) + 2 * margin,
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
