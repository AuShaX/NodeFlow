import type { NodeView } from '../types'
import { COLORS, FONT_STACK } from '../theme'
import { fontFor, LINE_HEIGHTS } from './textMeasure'

export type OutwardSide = 'left' | 'right' | 'down'

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

export function collapsedBadgeCenter(n: NodeView, outward: OutwardSide): { x: number; y: number } {
  if (outward === 'left') return { x: n.renderX - n.width / 2 - BADGE_R - 4, y: n.renderY }
  if (outward === 'down') return { x: n.renderX, y: n.renderY + n.height / 2 + BADGE_R + 4 }
  return { x: n.renderX + n.width / 2 + BADGE_R + 4, y: n.renderY }
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
