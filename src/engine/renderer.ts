import type { NodeView, Rect, SceneSource } from '../types'
import { expandRect, rectsIntersect } from '../types'
import type { Camera } from './camera'
import { visibleWorldRect } from './camera'
import { COLORS, FONT_STACK, resolveNodeColor, textOnFill } from '../theme'
import { presence } from '../state/presence'
import type { Animator } from './animator'
import { drawAffordances, drawNode } from './drawNode'
import { connectorBounds, crossLinkBounds, drawCrossLink, drawTreeConnector } from './drawConnector'

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
  linkSelection: string | null
  hover: string | null
  editingId: string | null
  editingLinkId: string | null
  searchPulse: { id: string; startedAt: number } | null
}

interface GridPattern {
  pattern: CanvasPattern
  sizePx: number
  level: number
  /** dot color baked into the tile — entries are remade on theme switches */
  dot: string
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
    const { camera, selection, linkSelection, hover, editingId, editingLinkId, searchPulse } =
      this.readUI()
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
        const color = resolveNodeColor(n.effectiveColor)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.18
        ctx.fillRect(b.x, b.y, b.w, b.h)
        ctx.globalAlpha = 1
        ctx.fillStyle = color
        const r = nodeRect(n)
        ctx.fillRect(r.x, r.y, r.w, r.h)
        painted++
      }
      this.finishStats(t0, now, painted)
      return
    }

    const dragging = this.scene.draggingIds

    // 1) Tree connectors (parents before children is irrelevant here, but we
    //    reuse the paint list to visit every parent→child edge once).
    for (const id of paintList) {
      const child = nodes.get(id)
      if (!child || (!child.visible && !child.vanishing) || child.parentId === null) continue
      if (dragging.has(id)) continue
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

    // 2) Cross-links.
    for (const link of this.scene.links) {
      const a = this.scene.getAnyNode(link.fromId)
      const b = this.scene.getAnyNode(link.toId)
      if (!a || !b) continue
      if ((!a.visible && !a.vanishing) || (!b.visible && !b.vanishing)) continue
      if (dragging.has(a.id) || dragging.has(b.id)) continue
      if (!rectsIntersect(crossLinkBounds(a, b), cullView)) continue
      drawCrossLink(ctx, a, b, link, {
        zoom,
        selected: linkSelection === link.id,
        hideLabel: editingLinkId === link.id,
      })
    }

    // 3) Nodes, parents before children.
    for (const id of paintList) {
      const n = nodes.get(id)
      if (!n || (!n.visible && !n.vanishing) || dragging.has(id)) continue
      if (!visibleIds.has(id) && !rectsIntersect(nodeRect(n), cullView)) continue
      drawNode(ctx, n, {
        zoom,
        selected: selection.has(id),
        hovered: hover === id && !selection.has(id),
        editing: editingId === id,
        outward: this.scene.outwardSide(n.id),
      })
      painted++
    }

    // 4) Deleted nodes still fading out (with their edges, so subtrees fade whole).
    for (const n of this.scene.exiting) {
      if (!rectsIntersect(nodeRect(n), cullView)) continue
      if (n.parentId !== null) {
        const parent = this.scene.getAnyNode(n.parentId)
        if (parent) {
          drawTreeConnector(ctx, parent, n, this.connectorAxis(n), this.connectorStyleFor(n))
        }
      }
      drawNode(ctx, n, {
        zoom,
        selected: false,
        hovered: false,
        editing: false,
        outward: 'right',
      })
      painted++
    }

    // 4b) Affordances (+ / – / link dot) on the hovered or single-selected node.
    if (zoom >= 0.25 && dragging.size === 0) {
      const affordanceIds = new Set<string>()
      if (hover) affordanceIds.add(hover)
      if (selection.size === 1) affordanceIds.add([...selection][0])
      for (const id of affordanceIds) {
        const n = nodes.get(id)
        if (n && n.visible && editingId !== id) {
          drawAffordances(ctx, n, this.scene.outwardSide(id))
        }
      }
    }

    // 4c) Search-jump pulse: two expanding rings fading over ~1.2s.
    if (searchPulse) {
      const n = nodes.get(searchPulse.id)
      const age = now - searchPulse.startedAt
      if (n && n.visible && age >= 0 && age < 1200) {
        const phase = (age % 600) / 600
        const grow = 5 + phase * 16
        const r = nodeRect(n)
        ctx.save()
        ctx.globalAlpha = (1 - phase) * 0.65
        ctx.strokeStyle = COLORS.accent
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.roundRect(
          r.x - grow,
          r.y - grow,
          r.w + 2 * grow,
          r.h + 2 * grow,
          (n.shape === 'pill' ? n.height / 2 : n.shape === 'rounded' ? 10 : 3) + grow,
        )
        ctx.stroke()
        ctx.restore()
        this.requestPaint() // keep the pulse animating
      }
    }

    // 5) Overlays (drag previews, marquee) — drawn by the interaction layer.
    this.overlayPainter?.(ctx, camera)

    // 6) Collaboration presence: remote selections, editing rings, cursors.
    if (presence.peers.size > 0) this.paintPresence(ctx, zoom)

    this.finishStats(t0, now, painted)
  }

  /** Remote peers (world-space ctx): chrome-sized via 1/zoom. */
  private paintPresence(ctx: CanvasRenderingContext2D, zoom: number): void {
    const s = 1 / zoom
    // selection outlines
    for (const [nodeId, color] of presence.selectedBy) {
      const n = this.scene.nodes.get(nodeId)
      if (!n || !n.visible) continue
      const r = nodeRect(n)
      const pad = 3 * s
      ctx.save()
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.85
      ctx.lineWidth = 2 * s
      ctx.beginPath()
      ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 8 * s + 4)
      ctx.stroke()
      ctx.restore()
    }
    // editing indicators: dashed ring + name tag
    for (const [nodeId, peer] of presence.editingBy) {
      const n = this.scene.nodes.get(nodeId)
      if (!n || !n.visible) continue
      const r = nodeRect(n)
      const pad = 6 * s
      ctx.save()
      ctx.strokeStyle = peer.user.color
      ctx.lineWidth = 1.5 * s
      ctx.setLineDash([5 * s, 4 * s])
      ctx.beginPath()
      ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 10 * s + 4)
      ctx.stroke()
      ctx.setLineDash([])
      this.nameTag(ctx, peer.user.name, peer.user.color, r.x, r.y - pad - 16 * s, s)
      ctx.restore()
    }
    // cursors
    for (const peer of presence.peers.values()) {
      if (!peer.cursor) continue
      const { x, y } = peer.cursor
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(s, s)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, 15)
      ctx.lineTo(4.2, 11.2)
      ctx.lineTo(10.4, 11.2)
      ctx.closePath()
      ctx.fillStyle = peer.user.color
      ctx.fill()
      ctx.strokeStyle = COLORS.surface
      ctx.lineWidth = 1.25
      ctx.stroke()
      ctx.restore()
      this.nameTag(ctx, peer.user.name, peer.user.color, x + 12 * s, y + 14 * s, s)
    }
  }

  private nameTag(
    ctx: CanvasRenderingContext2D,
    name: string,
    color: string,
    x: number,
    y: number,
    s: number,
  ): void {
    ctx.save()
    ctx.font = `600 ${10.5 * s}px ${FONT_STACK}`
    const w = ctx.measureText(name).width + 12 * s
    const h = 16 * s
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 8 * s)
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = textOnFill(color)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, x + 6 * s, y + h / 2 + 0.5 * s)
    ctx.restore()
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
    while (cur && cur.parentId !== null) cur = this.scene.getAnyNode(cur.parentId)
    return cur
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
    if (entry && entry.sizePx === sizePx && entry.dot === COLORS.dot) return entry
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
      entry = { pattern, sizePx, level, dot: COLORS.dot }
      this.gridPatterns.push(entry)
    } else {
      entry.pattern = pattern
      entry.sizePx = sizePx
      entry.dot = COLORS.dot
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
