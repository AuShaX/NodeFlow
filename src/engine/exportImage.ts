import type { NodeView, Rect, SceneSource } from '../types'
import { expandRect } from '../types'
import { COLORS, LIGHT_THEME } from '../theme'
import { drawNode } from './drawNode'
import { drawCrossLink, drawTreeConnector } from './drawConnector'

/**
 * Offscreen scene rendering for exports and board thumbnails: the renderer's
 * paint order (connectors → cross-links → nodes) without selection chrome,
 * overlays, culling or LOD. Exports always use the light palette so shared
 * artifacts look the same regardless of the author's theme.
 */

export interface PaintSceneOptions {
  /** canvas fill behind the map; null = transparent */
  background: string | null
}

/** Paint the whole scene. Assumes ctx is already in world space. */
export function paintScene(ctx: CanvasRenderingContext2D, scene: SceneSource): void {
  const nodes = scene.nodes
  for (const id of scene.paintList) {
    const child = nodes.get(id)
    if (!child || !child.visible || child.parentId === null) continue
    const parent = nodes.get(child.parentId)
    if (!parent) continue
    drawTreeConnector(ctx, parent, child, axisFor(scene, child), styleFor(scene, child))
  }
  for (const link of scene.links) {
    const a = scene.getAnyNode(link.fromId)
    const b = scene.getAnyNode(link.toId)
    if (!a || !b || !a.visible || !b.visible) continue
    drawCrossLink(ctx, a, b, link, { zoom: 1, selected: false, hideLabel: false })
  }
  for (const id of scene.paintList) {
    const n = nodes.get(id)
    if (!n || !n.visible) continue
    drawNode(ctx, n, {
      zoom: 1, // full detail regardless of output scale
      selected: false,
      hovered: false,
      editing: false,
      outward: scene.outwardSide(id),
    })
  }
}

export interface RenderOptions {
  /** device pixels per world unit (PNG default 2 per SPEC §11) */
  scale?: number
  /** world-unit padding around the content (SPEC: 64) */
  padding?: number
  /** canvas fill; null = transparent */
  background?: string | null
  /** cap on either canvas dimension (browser limits ~16k; stay well under) */
  maxDimension?: number
}

export interface RenderedScene {
  canvas: HTMLCanvasElement
  bounds: Rect
  scale: number
}

/** Render the scene to an offscreen canvas, fit to content + padding. */
export function renderSceneToCanvas(
  scene: SceneSource,
  opts: RenderOptions = {},
): RenderedScene | null {
  const content = scene.contentBounds()
  if (!content) return null
  const padding = opts.padding ?? 64
  const bounds = expandRect(content, padding)
  let scale = opts.scale ?? 2
  const maxDim = opts.maxDimension ?? 8192
  scale = Math.min(scale, maxDim / bounds.w, maxDim / bounds.h)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bounds.w * scale))
  canvas.height = Math.max(1, Math.round(bounds.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Exports are theme-independent: force the light palette for the paint pass.
  const live = { ...COLORS }
  Object.assign(COLORS, LIGHT_THEME)
  try {
    const background = opts.background === undefined ? COLORS.bg : opts.background
    if (background) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale)
    paintScene(ctx, scene)
  } finally {
    Object.assign(COLORS, live)
  }
  return { canvas, bounds, scale }
}

/** Small JPEG data-URL for the board-home grid. */
export function renderThumbnail(scene: SceneSource, width = 360): string | null {
  const content = scene.contentBounds()
  if (!content) return null
  const padded = expandRect(content, 48)
  const rendered = renderSceneToCanvas(scene, {
    scale: Math.min(1, width / padded.w),
    padding: 48,
    background: LIGHT_THEME.bg,
    maxDimension: 1200,
  })
  if (!rendered) return null
  try {
    return rendered.canvas.toDataURL('image/jpeg', 0.78)
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ helpers

function rootOf(scene: SceneSource, n: NodeView): NodeView | undefined {
  let cur: NodeView | undefined = n
  while (cur && cur.parentId !== null) cur = scene.getAnyNode(cur.parentId)
  return cur
}

const axisFor = (scene: SceneSource, child: NodeView): 'h' | 'v' =>
  rootOf(scene, child)?.dir === 'down' ? 'v' : 'h'

const styleFor = (scene: SceneSource, child: NodeView): 'curved' | 'elbow' =>
  rootOf(scene, child)?.connectorStyle ?? 'curved'
