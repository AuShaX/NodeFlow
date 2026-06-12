import type { NodeView, SceneSource } from '../types'
import { expandRect } from '../types'
import { FONT_STACK, LIGHT_THEME, resolveNodeColor, textOnFill, COLORS } from '../theme'
import { FONT_SIZES, LINE_HEIGHTS } from './textMeasure'
import type { ConnectorGeom } from './drawConnector'
import { bezierPoint, connectorGeom, crossLinkGeom, curvedControls } from './drawConnector'

/**
 * True-vector SVG export: same geometry sources as the canvas renderer
 * (connectorGeom/curvedControls/crossLinkGeom + cached wrapped text lines),
 * light palette always. Text uses Inter with system fallbacks — viewers
 * without the font substitute metrics-compatible sans.
 */

const f = (v: number): string => (Math.round(v * 100) / 100).toString()

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function exportSVG(scene: SceneSource, opts: { background?: string | null } = {}): string | null {
  const content = scene.contentBounds()
  if (!content) return null
  const b = expandRect(content, 64)

  // Force light palette for resolveNodeColor/textOnFill during the build.
  const live = { ...COLORS }
  Object.assign(COLORS, LIGHT_THEME)
  try {
    const parts: string[] = []
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.x)} ${f(b.y)} ${f(b.w)} ${f(b.h)}" width="${f(b.w)}" height="${f(b.h)}" font-family="${FONT_STACK.replace(/'/g, '')}">`,
    )
    const background = opts.background === undefined ? LIGHT_THEME.bg : opts.background
    if (background) {
      parts.push(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="${background}"/>`)
    }

    // 1) tree connectors
    for (const id of scene.paintList) {
      const child = scene.nodes.get(id)
      if (!child || !child.visible || child.parentId === null) continue
      const parent = scene.nodes.get(child.parentId)
      if (!parent) continue
      const root = rootOf(scene, child)
      const g = connectorGeom(parent, child, root?.dir === 'down' ? 'v' : 'h')
      const d =
        (root?.connectorStyle ?? 'curved') === 'curved' ? curvedPath(g) : elbowPath(g)
      const color = resolveNodeColor(child.effectiveColor)
      const width = child.depth === 1 ? 2.5 : 2
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`)
    }

    // 2) cross-links
    for (const link of scene.links) {
      const a = scene.getAnyNode(link.fromId)
      const c = scene.getAnyNode(link.toId)
      if (!a || !c || !a.visible || !c.visible) continue
      const g = crossLinkGeom(a, c)
      const dash = link.style === 'dashed' ? ' stroke-dasharray="7 5"' : ''
      parts.push(
        `<path d="M ${f(g.p.x)} ${f(g.p.y)} C ${f(g.cp1.x)} ${f(g.cp1.y)} ${f(g.cp2.x)} ${f(g.cp2.y)} ${f(g.c.x)} ${f(g.c.y)}" fill="none" stroke="${COLORS.muted}" stroke-width="2" stroke-linecap="round"${dash}/>`,
      )
      if (link.arrow === 'end' || link.arrow === 'both') {
        parts.push(arrowhead(g.c, bezierPoint(g, 0.92)))
      }
      if (link.arrow === 'both') parts.push(arrowhead(g.p, bezierPoint(g, 0.08)))
      if (link.label) parts.push(linkLabel(link.label, bezierPoint(g, 0.5)))
    }

    // 3) nodes (parents before children) + collapsed badges
    for (const id of scene.paintList) {
      const n = scene.nodes.get(id)
      if (!n || !n.visible) continue
      parts.push(nodeSvg(n))
      if (n.collapsed && n.subtreeCount > 0) parts.push(badgeSvg(scene, n))
    }

    parts.push('</svg>')
    return parts.join('\n')
  } finally {
    Object.assign(COLORS, live)
  }
}

function nodeSvg(n: NodeView): string {
  const deep = n.depth >= 2
  const color = resolveNodeColor(n.effectiveColor)
  const x = n.x - n.width / 2
  const y = n.y - n.height / 2
  const rx = n.shape === 'pill' ? n.height / 2 : n.shape === 'rounded' ? 10 : 3
  const fill = deep ? COLORS.surface : color
  const stroke = deep ? ` stroke="${color}" stroke-width="2"` : ''
  const out = [
    `<rect x="${f(x)}" y="${f(y)}" width="${f(n.width)}" height="${f(n.height)}" rx="${f(rx)}" fill="${fill}"${stroke}/>`,
  ]
  if (n.textLines.length > 0) {
    const textColor = deep ? color : textOnFill(fill)
    const size = FONT_SIZES[n.textStyle.size]
    const lh = LINE_HEIGHTS[n.textStyle.size]
    const weight = n.textStyle.bold ? 600 : 500
    let ty = n.y - ((n.textLines.length - 1) * lh) / 2
    const spans = n.textLines
      .map((line) => {
        const s = `<tspan x="${f(n.x)}" y="${f(ty)}">${esc(line) || ' '}</tspan>`
        ty += lh
        return s
      })
      .join('')
    out.push(
      `<text fill="${textColor}" font-size="${size}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central">${spans}</text>`,
    )
  }
  return out.join('\n')
}

function badgeSvg(scene: SceneSource, n: NodeView): string {
  const outward = scene.outwardSide(n.id)
  const r = 9
  const cx = outward === 'left' ? n.x - n.width / 2 - r - 4 : outward === 'down' ? n.x : n.x + n.width / 2 + r + 4
  const cy = outward === 'down' ? n.y + n.height / 2 + r + 4 : n.y
  const color = resolveNodeColor(n.effectiveColor)
  const label = n.subtreeCount > 99 ? '99+' : String(n.subtreeCount)
  return (
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${COLORS.surface}" stroke="${color}" stroke-width="1.5"/>` +
    `<text x="${f(cx)}" y="${f(cy + 0.5)}" fill="${color}" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central">${label}</text>`
  )
}

function arrowhead(tip: { x: number; y: number }, from: { x: number; y: number }): string {
  const angle = (Math.atan2(tip.y - from.y, tip.x - from.x) * 180) / Math.PI
  return `<polygon points="0,0 -8,-3.6 -8,3.6" fill="${COLORS.muted}" transform="translate(${f(tip.x)} ${f(tip.y)}) rotate(${f(angle)})"/>`
}

function linkLabel(label: string, mid: { x: number; y: number }): string {
  const w = label.length * 6.2 + 14 // close-enough width without canvas metrics
  return (
    `<rect x="${f(mid.x - w / 2)}" y="${f(mid.y - 11)}" width="${f(w)}" height="22" rx="9" fill="${COLORS.surface}" stroke="${COLORS.border}"/>` +
    `<text x="${f(mid.x)}" y="${f(mid.y + 0.5)}" fill="${COLORS.muted}" font-size="11" font-weight="500" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`
  )
}

function curvedPath(g: ConnectorGeom): string {
  const [c1, c2] = curvedControls(g)
  return `M ${f(g.p.x)} ${f(g.p.y)} C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(g.c.x)} ${f(g.c.y)}`
}

/** Elbow with rounded corners via quadratic bends (matches the canvas arcTo look). */
function elbowPath(g: ConnectorGeom): string {
  if (g.axis === 'h') {
    const midX = (g.p.x + g.c.x) / 2
    const r = Math.min(10, Math.abs(g.c.x - g.p.x) / 2, Math.abs(g.c.y - g.p.y) / 2)
    const sx = Math.sign(g.c.x - g.p.x) || 1
    const sy = Math.sign(g.c.y - g.p.y) || 1
    return (
      `M ${f(g.p.x)} ${f(g.p.y)} L ${f(midX - sx * r)} ${f(g.p.y)} ` +
      `Q ${f(midX)} ${f(g.p.y)} ${f(midX)} ${f(g.p.y + sy * r)} L ${f(midX)} ${f(g.c.y - sy * r)} ` +
      `Q ${f(midX)} ${f(g.c.y)} ${f(midX + sx * r)} ${f(g.c.y)} L ${f(g.c.x)} ${f(g.c.y)}`
    )
  }
  const midY = (g.p.y + g.c.y) / 2
  const r = Math.min(10, Math.abs(g.c.y - g.p.y) / 2, Math.abs(g.c.x - g.p.x) / 2)
  const sy = Math.sign(g.c.y - g.p.y) || 1
  const sx = Math.sign(g.c.x - g.p.x) || 1
  return (
    `M ${f(g.p.x)} ${f(g.p.y)} L ${f(g.p.x)} ${f(midY - sy * r)} ` +
    `Q ${f(g.p.x)} ${f(midY)} ${f(g.p.x + sx * r)} ${f(midY)} L ${f(g.c.x - sx * r)} ${f(midY)} ` +
    `Q ${f(g.c.x)} ${f(midY)} ${f(g.c.x)} ${f(midY + sy * r)} L ${f(g.c.x)} ${f(g.c.y)}`
  )
}

function rootOf(scene: SceneSource, n: NodeView): NodeView | undefined {
  let cur: NodeView | undefined = n
  while (cur && cur.parentId !== null) cur = scene.getAnyNode(cur.parentId)
  return cur
}
