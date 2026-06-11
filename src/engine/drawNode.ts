import type { NodeView, OutwardSide, Point } from '../types'
import { COLORS, FONT_STACK } from '../theme'
import { fontFor, LINE_HEIGHTS } from './textMeasure'

export type { OutwardSide }

export interface NodeDrawState {
  zoom: number
  selected: boolean
  hovered: boolean
  /** node text is being edited in the DOM overlay — paint the box, hide the text */
  editing: boolean
  outward: OutwardSide
  /** extra alpha multiplier (drag ghosts) */
  alpha?: number
}

const radiusFor = (n: NodeView): number =>
  n.shape === 'pill' ? n.height / 2 : n.shape === 'rounded' ? 10 : 3

export function nodePath(ctx: CanvasRenderingContext2D, n: NodeView): void {
  const w = n.width
  const h = n.height
  ctx.beginPath()
  ctx.roundRect(n.renderX - w / 2, n.renderY - h / 2, w, h, radiusFor(n))
}

/** Paint one node at its animated position. Assumes ctx is in world space. */
export function drawNode(ctx: CanvasRenderingContext2D, n: NodeView, s: NodeDrawState): void {
  const baseAlpha = n.renderAlpha * (s.alpha ?? 1)
  if (baseAlpha <= 0.01) return

  const scaled = n.renderScale !== 1
  ctx.save()
  ctx.globalAlpha = baseAlpha
  if (scaled) {
    ctx.translate(n.renderX, n.renderY)
    ctx.scale(n.renderScale, n.renderScale)
    ctx.translate(-n.renderX, -n.renderY)
  }

  const deep = n.depth >= 2

  // LOD: tiny zoom — solid colored block, no text, no chrome.
  if (s.zoom < 0.25) {
    ctx.fillStyle = n.effectiveColor
    nodePath(ctx, n)
    ctx.fill()
    ctx.restore()
    return
  }

  // Box
  nodePath(ctx, n)
  ctx.fillStyle = deep ? COLORS.surface : n.effectiveColor
  ctx.fill()
  if (deep) {
    ctx.strokeStyle = n.effectiveColor
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // Text
  if (!s.editing && n.textLines.length > 0) {
    ctx.fillStyle = deep ? n.effectiveColor : '#FFFFFF'
    ctx.font = fontFor(n.textStyle)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lh = LINE_HEIGHTS[n.textStyle.size]
    let ty = n.renderY - ((n.textLines.length - 1) * lh) / 2
    for (const line of n.textLines) {
      if (line !== '') ctx.fillText(line, n.renderX, ty)
      ty += lh
    }
  }

  // Collapsed badge: small colored circle with descendant count on the outward edge.
  if (n.collapsed && n.subtreeCount > 0) {
    drawCollapsedBadge(ctx, n, s.outward)
  }

  ctx.restore()

  // Selection / hover chrome — screen-constant stroke widths, drawn unscaled.
  if (s.selected || s.hovered) {
    ctx.save()
    ctx.globalAlpha = baseAlpha
    const pad = 3 / s.zoom
    const r = radiusFor(n) + pad
    const x = n.renderX - n.width / 2 - pad
    const y = n.renderY - n.height / 2 - pad
    const w = n.width + 2 * pad
    const h = n.height + 2 * pad
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.strokeStyle = COLORS.accent
    if (s.selected) {
      ctx.lineWidth = 2 / s.zoom
      ctx.stroke()
      const hs = 7 / s.zoom // handle size
      ctx.fillStyle = COLORS.surface
      ctx.lineWidth = 1.5 / s.zoom
      for (const [hx, hy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        ctx.beginPath()
        ctx.rect(hx - hs / 2, hy - hs / 2, hs, hs)
        ctx.fill()
        ctx.stroke()
      }
    } else {
      ctx.globalAlpha = baseAlpha * 0.45
      ctx.lineWidth = 1.5 / s.zoom
      ctx.stroke()
    }
    ctx.restore()
  }
}

const BADGE_R = 9
const AFFORDANCE_R = 8

export function collapsedBadgeCenter(n: NodeView, outward: OutwardSide): { x: number; y: number } {
  if (outward === 'left') return { x: n.renderX - n.width / 2 - BADGE_R - 4, y: n.renderY }
  if (outward === 'down') return { x: n.renderX, y: n.renderY + n.height / 2 + BADGE_R + 4 }
  return { x: n.renderX + n.width / 2 + BADGE_R + 4, y: n.renderY }
}

/** Hover "–" (collapse) sits where the badge appears when collapsed. */
export const minusCenter = collapsedBadgeCenter

/** Hover "+" (add child): outward edge, past the minus when one is shown. */
export function plusCenter(n: NodeView, outward: OutwardSide, pastMinus: boolean): Point {
  const off = BADGE_R + 4 + (pastMinus ? 2 * AFFORDANCE_R + 6 : 0)
  if (outward === 'left') return { x: n.renderX - n.width / 2 - off, y: n.renderY }
  if (outward === 'down') return { x: n.renderX, y: n.renderY + n.height / 2 + off }
  return { x: n.renderX + n.width / 2 + off, y: n.renderY }
}

/** Cross-link drag handle: top-center edge dot. */
export function linkDotCenter(n: NodeView): Point {
  return { x: n.renderX, y: n.renderY - n.height / 2 }
}

export type Affordance = 'badge' | 'minus' | 'plus' | 'linkdot'

/**
 * Which interactive affordance (if any) a world point hits on this node.
 * Single source of truth shared by painting and the interaction machine.
 * `active` = the node is hovered or selected (plus/minus/dot only show then);
 * the collapsed badge is always live.
 */
export function affordanceAt(
  n: NodeView,
  outward: OutwardSide,
  pt: Point,
  active: boolean,
): Affordance | null {
  const slop = 3
  const within = (c: Point, r: number) => Math.hypot(pt.x - c.x, pt.y - c.y) <= r + slop
  if (n.collapsed && n.subtreeCount > 0) {
    if (within(collapsedBadgeCenter(n, outward), BADGE_R)) return 'badge'
  }
  if (!active) return null
  if (within(linkDotCenter(n), 5)) return 'linkdot'
  const hasMinus = !n.collapsed && n.childrenIds.length > 0
  if (hasMinus && within(minusCenter(n, outward), AFFORDANCE_R)) return 'minus'
  if (within(plusCenter(n, outward, hasMinus), AFFORDANCE_R)) return 'plus'
  return null
}

/** Paint hover/selection affordances (+ / – / link dot). World-space ctx. */
export function drawAffordances(
  ctx: CanvasRenderingContext2D,
  n: NodeView,
  outward: OutwardSide,
): void {
  const hasMinus = !n.collapsed && n.childrenIds.length > 0
  ctx.save()
  ctx.globalAlpha = n.renderAlpha

  const circle = (c: Point, r: number) => {
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.surface
    ctx.fill()
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  const glyph = (c: Point, plus: boolean) => {
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(c.x - 4, c.y)
    ctx.lineTo(c.x + 4, c.y)
    if (plus) {
      ctx.moveTo(c.x, c.y - 4)
      ctx.lineTo(c.x, c.y + 4)
    }
    ctx.stroke()
  }

  if (hasMinus) {
    const mc = minusCenter(n, outward)
    circle(mc, AFFORDANCE_R)
    glyph(mc, false)
  }
  if (!n.collapsed) {
    const pc = plusCenter(n, outward, hasMinus)
    circle(pc, AFFORDANCE_R)
    glyph(pc, true)
  }
  // link dot
  const dot = linkDotCenter(n)
  ctx.beginPath()
  ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.accent
  ctx.fill()
  ctx.strokeStyle = COLORS.surface
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

function drawCollapsedBadge(
  ctx: CanvasRenderingContext2D,
  n: NodeView,
  outward: OutwardSide,
): void {
  const { x, y } = collapsedBadgeCenter(n, outward)
  ctx.beginPath()
  ctx.arc(x, y, BADGE_R, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.surface
  ctx.fill()
  ctx.strokeStyle = n.effectiveColor
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = n.effectiveColor
  ctx.font = `600 10px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = n.subtreeCount > 99 ? '99+' : String(n.subtreeCount)
  ctx.fillText(label, x, y + 0.5)
}
