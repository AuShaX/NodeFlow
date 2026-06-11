import type { NodeView, Rect, SceneSource } from '../types'
import { expandRect, rectsIntersect } from '../types'
import type { Camera } from './camera'
import { visibleWorldRect } from './camera'
import { COLORS } from '../theme'
import type { Animator } from './animator'
import type { OutwardSide } from './drawNode'
import { drawNode } from './drawNode'
import { connectorBounds, drawTreeConnector } from './drawConnector'

export interface RendererStats {
  /** paints in the last sampled second */
  fps: number
  paintedNodes: number
  lastPaintMs: number
  lastLayoutMs: number
  totalPaints: number
}

interface UIReadout {
  camera: Camera
  selection: ReadonlySet<string>
  hover: string | null
  editingId: string | null
}

interface GridPattern {
  pattern: CanvasPattern
  sizePx: number
  level: number
}

const GRID_LEVELS = [8, 40, 200]

/**
 * Owns the canvas, the rAF loop and draw order. Paints only when something
 * is dirty or tweens are running — idle means zero paints.
 */
export class Renderer {
  readonly stats: RendererStats = {
    fps: 0,
    paintedNodes: 0,
    lastPaintMs: 0,
    lastLayoutMs: 0,
    totalPaints: 0,
  }

  /** extra painting on top of the scene (drag ghosts, marquee) — set by interactions */
  overlayPainter: ((ctx: CanvasRenderingContext2D, cam: Camera) => void) | null = null

  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scene: SceneSource
  private animator: Animator
  private readUI: () => UIReadout

  private dirty = true
  private rafId: number | null = null
  private destroyed = false
  private dpr = 1
  private cssW = 0
  private cssH = 0
  private gridPatterns: GridPattern[] = []
  private paintTimes: number[] = []

  constructor(
    canvas: HTMLCanvasElement,
    scene: SceneSource,
    animator: Animator,
    readUI: () => UIReadout,
  ) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    this.ctx = ctx
    this.scene = scene
    this.animator = animator
    this.readUI = readUI
    this.resize()
  }

  /** Mark the scene dirty and make sure a frame is scheduled. */
  requestPaint(): void {
    this.dirty = true
    this.schedule()
  }

  /** Re-read css size and devicePixelRatio; resizes the backing store. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.cssW = Math.max(1, rect.width)
    this.cssH = Math.max(1, rect.height)
    this.dpr = window.devicePixelRatio || 1
    const bw = Math.round(this.cssW * this.dpr)
    const bh = Math.round(this.cssH * this.dpr)
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw
      this.canvas.height = bh
    }
    this.requestPaint()
  }

  get viewportSize(): { w: number; h: number } {
    return { w: this.cssW, h: this.cssH }
  }

  destroy(): void {
    this.destroyed = true
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  private schedule(): void {
    if (this.rafId !== null || this.destroyed) return
    this.rafId = requestAnimationFrame(this.frame)
  }

  private frame = (now: number): void => {
    this.rafId = null
    if (this.destroyed) return
    const animating = this.animator.tick(now)
    if (this.dirty || animating) {
      this.dirty = false
      this.paint(now)
    }
    if (animating) this.schedule()
  }

  // ---------------------------------------------------------------- painting

  private paint(now: number): void {
    const t0 = performance.now()
    const { camera, selection, hover, editingId } = this.readUI()
    const ctx = this.ctx
    const dpr = this.dpr
    const zoom = camera.zoom

    // Background (device space).
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.drawGrid(camera)

    // World space: one transform for everything on the board.
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -camera.x * zoom * dpr, -camera.y * zoom * dpr)

    const view = expandRect(visibleWorldRect(camera, this.cssW, this.cssH), 0)
    const cullView = expandRect(view, Math.max(view.w, view.h) * 0.1) // ~20% total margin
    const visibleIds = this.scene.spatial.queryRect(cullView)

    const nodes = this.scene.nodes
    const paintList = this.scene.paintList
    let painted = 0

    // Ultra-low zoom LOD: draw root subtree bounds only.
    if (zoom < 0.1) {
      for (const id of this.scene.rootIds) {
        const n = nodes.get(id)
        if (!n) continue
        const b = n.subtreeBounds
        if (!rectsIntersect(b, cullView)) continue
        ctx.fillStyle = n.effectiveColor
        ctx.globalAlpha = 0.18
        ctx.fillRect(b.x, b.y, b.w, b.h)
        ctx.globalAlpha = 1
        ctx.fillStyle = n.effectiveColor
        const r = nodeRect(n)
        ctx.fillRect(r.x, r.y, r.w, r.h)
        painted++
      }
      this.finishStats(t0, now, painted)
      return
    }

    // 1) Tree connectors (parents before children is irrelevant here, but we
    //    reuse the paint list to visit every parent→child edge once).
    for (const id of paintList) {
      const child = nodes.get(id)
      if (!child || !child.visible || child.parentId === null) continue
      const parent = nodes.get(child.parentId)
      if (!parent) continue
      if (!rectsIntersect(connectorBounds(parent, child), cullView)) continue
      drawTreeConnector(
        ctx,
        parent,
        child,
        this.connectorAxis(child),
        this.connectorStyleFor(child),
      )
    }

    // 2) Cross-links (M4).

    // 3) Nodes, parents before children.
    for (const id of paintList) {
      const n = nodes.get(id)
      if (!n || !n.visible) continue
      if (!visibleIds.has(id) && !rectsIntersect(nodeRect(n), cullView)) continue
      drawNode(ctx, n, {
        zoom,
        selected: selection.has(id),
        hovered: hover === id && !selection.has(id),
        editing: editingId === id,
        outward: this.outwardSide(n),
      })
      painted++
    }

    // 4) Overlays (drag previews, marquee) — drawn by the interaction layer.
    this.overlayPainter?.(ctx, camera)

    this.finishStats(t0, now, painted)
  }

  private finishStats(t0: number, now: number, painted: number): void {
    this.stats.lastPaintMs = performance.now() - t0
    this.stats.paintedNodes = painted
    this.stats.totalPaints++
    this.paintTimes.push(now)
    while (this.paintTimes.length > 0 && this.paintTimes[0] < now - 1000) this.paintTimes.shift()
    this.stats.fps = this.paintTimes.length
  }

  /** Layout axis of the edge into `child` (vertical only under a dir:'down' root). */
  private connectorAxis(child: NodeView): 'h' | 'v' {
    const root = this.rootOf(child)
    return root?.dir === 'down' ? 'v' : 'h'
  }

  private connectorStyleFor(child: NodeView): 'curved' | 'elbow' {
    const root = this.rootOf(child)
    return root?.connectorStyle ?? 'curved'
  }

  private rootOf(n: NodeView): NodeView | undefined {
    let cur: NodeView | undefined = n
    const nodes = this.scene.nodes
    while (cur && cur.parentId !== null) cur = nodes.get(cur.parentId)
    return cur
  }

  private outwardSide(n: NodeView): OutwardSide {
    const root = this.rootOf(n)
    if (root?.dir === 'down') return 'down'
    if (n.parentId === null) return 'right'
    const parent = this.scene.nodes.get(n.parentId)
    if (parent && n.renderX < parent.renderX) return 'left'
    return 'right'
  }

  // ------------------------------------------------------------------- grid

  /**
   * Dot grid in device space using cached canvas patterns: one pattern fill
   * per visible level instead of thousands of arcs. Spacing adapts to zoom by
   * cross-fading the 8/40/200 world-unit levels (SPEC §8).
   */
  private drawGrid(camera: Camera): void {
    const ctx = this.ctx
    const dpr = this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (const level of GRID_LEVELS) {
      const screenSpacing = level * camera.zoom // css px between dots
      const alpha = gridLevelAlpha(screenSpacing)
      if (alpha <= 0.02) continue
      const sizePx = Math.max(4, Math.round(level * camera.zoom * dpr))
      const pat = this.gridPattern(level, sizePx)
      if (!pat) continue
      // Align the pattern with world coordinates: a dot sits at every
      // world-space multiple of `level`. The pattern dot is at the tile
      // center, so shift the pattern phase so a center lands on the device
      // position of world (0, 0).
      const originX = -camera.x * camera.zoom * dpr
      const originY = -camera.y * camera.zoom * dpr
      const half = sizePx / 2
      const tx = mod(originX - half, sizePx) - sizePx
      const ty = mod(originY - half, sizePx) - sizePx
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = pat.pattern
      ctx.translate(tx, ty)
      ctx.fillRect(-tx, -ty, this.canvas.width, this.canvas.height)
      ctx.restore()
    }
  }

  private gridPattern(level: number, sizePx: number): GridPattern | null {
    let entry = this.gridPatterns.find((p) => p.level === level)
    if (entry && entry.sizePx === sizePx) return entry
    const tile = document.createElement('canvas')
    tile.width = sizePx
    tile.height = sizePx
    const tctx = tile.getContext('2d')
    if (!tctx) return null
    const r = Math.min(Math.max(1, 1.1 * this.dpr), sizePx * 0.12)
    tctx.fillStyle = COLORS.dot
    tctx.beginPath()
    tctx.arc(sizePx / 2, sizePx / 2, r, 0, Math.PI * 2)
    tctx.fill()
    const pattern = this.ctx.createPattern(tile, 'repeat')
    if (!pattern) return null
    if (!entry) {
      entry = { pattern, sizePx, level }
      this.gridPatterns.push(entry)
    } else {
      entry.pattern = pattern
      entry.sizePx = sizePx
    }
    return entry
  }
}

const nodeRect = (n: NodeView): Rect => ({
  x: n.renderX - n.width / 2,
  y: n.renderY - n.height / 2,
  w: n.width,
  h: n.height,
})

/** Fade a grid level in/out based on its on-screen dot spacing (css px). */
function gridLevelAlpha(screenSpacing: number): number {
  const FADE_IN_LO = 14
  const FADE_IN_HI = 24
  const FADE_OUT_LO = 70
  const FADE_OUT_HI = 110
  if (screenSpacing <= FADE_IN_LO || screenSpacing >= FADE_OUT_HI) return 0
  let a = 1
  if (screenSpacing < FADE_IN_HI) a = (screenSpacing - FADE_IN_LO) / (FADE_IN_HI - FADE_IN_LO)
  else if (screenSpacing > FADE_OUT_LO)
    a = 1 - (screenSpacing - FADE_OUT_LO) / (FADE_OUT_HI - FADE_OUT_LO)
  return a * a * (3 - 2 * a) // smoothstep
}

const mod = (v: number, m: number): number => ((v % m) + m) % m
