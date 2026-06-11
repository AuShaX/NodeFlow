import * as Y from 'yjs'
import type { LinkView, NodeView, OutwardSide, Rect, SceneSource, Side } from '../types'
import { nodeLayoutRect, rectUnion } from '../types'
import { SpatialIndex } from '../engine/spatialIndex'
import { measureNode } from '../engine/textMeasure'
import type { Animator } from '../engine/animator'
import { ENTER_TWEEN_MS, EXIT_TWEEN_MS } from '../engine/animator'
import { ROOT_DEFAULT_COLOR } from '../theme'
import type { LayoutNodeData, SpacingTokens } from '../layout/mindmapLayout'
import { DEFAULT_SPACING, layoutMindmapRoot } from '../layout/mindmapLayout'
import type { BoardDoc } from './schema'
import { getSpacing } from './schema'

/**
 * Yjs → plain-JS mirror (SPEC §5). Subscribes to the document, maintains
 * NodeViews with derived data, runs incremental layout per dirty root, and
 * drives the animator so every structural change reflows smoothly. The
 * renderer reads ONLY from this mirror (never from Yjs).
 */

const STRUCTURAL_FIELDS = new Set([
  'parentId',
  'order',
  'collapsed',
  'layout',
  'mx',
  'my',
  'side',
  'dir',
])
const TEXT_FIELDS = new Set(['text', 'textSize', 'bold'])

export const PHANTOM_ID = '__phantom__'

/** Live drop preview during a node drag: where the subtree would land. */
export interface DragPreview {
  parentId: string
  /** insertion index among the candidate's (side-filtered) auto children */
  index: number
  side: Side | null
}

export class Mirror implements SceneSource {
  nodes = new Map<string, NodeView>()
  paintList: string[] = []
  rootIds: string[] = []
  links: LinkView[] = []
  spatial = new SpatialIndex()
  exiting: NodeView[] = []

  /** nodes being dragged (tops + descendants): excluded from layout & main paint */
  draggingIds: ReadonlySet<string> = new Set()
  /** where the phantom slot landed in the preview layout (world center) */
  phantomSlot: { x: number; y: number } | null = null

  spacing: SpacingTokens = { ...DEFAULT_SPACING }
  boardName = ''
  lastLayoutMs = 0
  /** bumped on every doc-driven update (cheap change detection for chrome) */
  version = 0

  private dragTops = new Set<string>()
  private preview: DragPreview | null = null
  /** roots touched by drag previews, relaid out together while dragging */
  private dragRoots = new Set<string>()
  /** slot changes for these ids apply instantly (free-move follows the cursor) */
  private immediateIds: ReadonlySet<string> | null = null

  private bd: BoardDoc
  private animator: Animator
  private onUpdate: () => void
  private listeners = new Set<() => void>()
  private observingNodes: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  private observingLinks: () => void
  private observingMeta: () => void

  constructor(bd: BoardDoc, animator: Animator, onUpdate: () => void) {
    this.bd = bd
    this.animator = animator
    this.onUpdate = onUpdate
    this.spacing = getSpacing(bd)
    this.boardName = (bd.meta.get('name') as string) ?? ''
    this.observingNodes = (events) => this.handleNodeEvents(events)
    this.observingLinks = () => this.rebuildLinks()
    this.observingMeta = () => this.handleMetaChange()
    bd.nodes.observeDeep(this.observingNodes)
    bd.links.observeDeep(this.observingLinks)
    bd.meta.observe(this.observingMeta)
    this.fullRebuild()
  }

  destroy(): void {
    this.bd.nodes.unobserveDeep(this.observingNodes)
    this.bd.links.unobserveDeep(this.observingLinks)
    this.bd.meta.unobserve(this.observingMeta)
    this.listeners.clear()
  }

  /** Chrome subscription: fires after every mirror update (version bump). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Version bump + repaint + chrome notification — every doc-driven update ends here. */
  private bump(): void {
    this.version++
    this.onUpdate()
    for (const fn of this.listeners) fn()
  }

  /** Meta changes: spacing tokens reflow every tree; the name just re-renders chrome. */
  private handleMetaChange(): void {
    this.boardName = (this.bd.meta.get('name') as string) ?? ''
    const next = getSpacing(this.bd)
    const cur = this.spacing
    if (
      next.levelGap !== cur.levelGap ||
      next.siblingGap !== cur.siblingGap ||
      next.branchGap !== cur.branchGap ||
      next.compactness !== cur.compactness
    ) {
      this.spacing = next
      this.relayout(new Set(this.rootIds), new Set())
    }
    this.bump()
  }

  getAnyNode(id: string): NodeView | undefined {
    return this.nodes.get(id) ?? this.exiting.find((n) => n.id === id)
  }

  contentBounds(): Rect | null {
    let bounds: Rect | null = null
    for (const id of this.rootIds) {
      const n = this.nodes.get(id)
      if (!n) continue
      bounds = bounds ? rectUnion(bounds, n.subtreeBounds) : n.subtreeBounds
    }
    return bounds
  }

  /** Root id of the tree containing `id` (per current mirror state). */
  rootOf(id: string): string {
    let cur = this.nodes.get(id)
    while (cur && cur.parentId !== null) {
      const p = this.nodes.get(cur.parentId)
      if (!p) break
      cur = p
    }
    return cur?.id ?? id
  }

  /** Which way a node's children grow — where badges and affordances sit. */
  outwardSide(id: string): OutwardSide {
    const n = this.getAnyNode(id)
    if (!n) return 'right'
    const root = this.nodes.get(this.rootOf(id))
    if (root?.dir === 'down') return 'down'
    if (n.parentId === null) return 'right'
    const parent = this.getAnyNode(n.parentId)
    if (parent && n.renderX < parent.renderX) return 'left'
    return 'right'
  }

  /** Visible-subtree cross-axis extent, used for side auto-balancing. */
  subtreeHeight(id: string): number {
    const n = this.nodes.get(id)
    return n ? n.subtreeBounds.h : 0
  }

  // ------------------------------------------------------------ drag preview

  /**
   * Start a node drag: the tops' subtrees leave layout & the main paint pass
   * (the gap behind them closes, animated). The interaction layer paints them
   * as a ghost from their frozen render positions.
   */
  beginDrag(topIds: string[]): void {
    this.dragTops = new Set(topIds)
    const all = new Set<string>()
    const collect = (id: string): void => {
      all.add(id)
      const n = this.nodes.get(id)
      if (n) for (const c of n.childrenIds) collect(c)
    }
    for (const id of topIds) collect(id)
    this.draggingIds = all
    this.preview = null
    this.dragRoots.clear()
    for (const id of topIds) this.dragRoots.add(this.rootOf(id))
    for (const id of all) this.animator.cancel(id)
    this.relayout(new Set(this.dragRoots), new Set())
    this.bump()
  }

  /** Update the drop preview; relays out only when the target actually changed. */
  setDragPreview(p: DragPreview | null): void {
    const prev = this.preview
    const same =
      (prev === null && p === null) ||
      (prev !== null &&
        p !== null &&
        prev.parentId === p.parentId &&
        prev.index === p.index &&
        prev.side === p.side)
    if (same) return
    this.preview = p
    if (prev) this.dragRoots.add(this.rootOf(prev.parentId))
    if (p) this.dragRoots.add(this.rootOf(p.parentId))
    this.relayout(new Set(this.dragRoots), new Set())
    this.bump()
  }

  /**
   * End the drag (commit or revert happens in the caller AFTER this, so the
   * resulting Yjs relayout sees a drag-free mirror and retargets tweens from
   * the ghost positions the caller wrote into renderX/renderY).
   */
  endDrag(): void {
    const roots = new Set(this.dragRoots)
    this.dragTops.clear()
    this.draggingIds = new Set()
    this.preview = null
    this.phantomSlot = null
    this.dragRoots.clear()
    this.relayout(roots, new Set())
    this.bump()
  }

  get isDragging(): boolean {
    return this.dragTops.size > 0
  }

  /**
   * The ordered child list insertion indexes refer to: auto-layout children
   * of `parentId` (excluding any mid-drag tops), side-filtered when the
   * parent is a both-sides root. Shared by drop-preview layout and commits.
   */
  insertionUniverse(parentId: string, side: Side | null, baseKids?: string[]): string[] {
    const p = this.nodes.get(parentId)
    if (!p) return []
    const kids = baseKids ?? p.childrenIds.filter((c) => !this.dragTops.has(c))
    return kids.filter((c) => {
      const n = this.nodes.get(c)
      if (!n || n.layout === 'manual') return false
      if (p.parentId === null && (p.dir ?? 'both') === 'both' && side) {
        return (n.side ?? 'right') === side
      }
      return true
    })
  }

  /** During free-move, slot changes for these ids snap instead of tweening. */
  setImmediate(ids: ReadonlySet<string> | null): void {
    this.immediateIds = ids
  }

  // ------------------------------------------------------------- Yjs intake

  private handleNodeEvents(events: Y.YEvent<Y.Map<unknown>>[]): void {
    const added: string[] = []
    const removed: string[] = []
    const dirtyRoots = new Set<string>()
    let needsDerived = false

    for (const ev of events) {
      if (ev.target === this.bd.nodes) {
        ev.changes.keys.forEach((change, id) => {
          if (change.action === 'add' || change.action === 'update') added.push(id)
          else if (change.action === 'delete') removed.push(id)
        })
      } else {
        const id = ev.path[0] as string
        const view = this.nodes.get(id)
        if (!view) continue
        // capture the old root BEFORE field application (reparent case)
        dirtyRoots.add(this.rootOf(id))
        let structural = false
        ev.changes.keys.forEach((_change, key) => {
          if (this.applyField(view, key)) structural = true
        })
        if (structural) needsDerived = true
        dirtyRoots.add(this.rootOf(id)) // may differ after parentId change — resolved after derived pass below
      }
    }

    for (const id of removed) {
      const view = this.nodes.get(id)
      if (!view) continue
      dirtyRoots.add(this.rootOf(id))
      this.beginExit(view)
      this.nodes.delete(id)
      this.spatial.remove(id)
      needsDerived = true
    }

    for (const id of added) {
      const m = this.bd.nodes.get(id)
      if (!m) continue
      const view = this.buildView(id, m)
      view.renderAlpha = 0
      view.renderScale = 0.85
      this.nodes.set(id, view)
      needsDerived = true
      // dirty root resolved after derived pass (parents may also be new)
    }

    if (needsDerived || added.length > 0 || removed.length > 0) {
      this.rebuildDerived()
      // re-resolve dirty roots now that parent chains are consistent
      for (const id of added) dirtyRoots.add(this.rootOf(id))
      const liveRoots = new Set(this.rootIds)
      const targets = new Set<string>()
      for (const r of dirtyRoots) if (liveRoots.has(r)) targets.add(this.rootOf(r))
      this.relayout(targets, new Set(added))
    } else if (dirtyRoots.size > 0) {
      // visual-only changes (color/shape): recompute colors, repaint
      this.rebuildDerived()
      this.refreshSubtreeBoundsAndSpatial()
    }
    this.bump()
  }

  /** Apply one Yjs field to a view. Returns true when the change affects layout. */
  private applyField(view: NodeView, key: string): boolean {
    const m = this.bd.nodes.get(view.id)
    if (!m) return false
    const get = <T>(k: string): T => m.get(k) as T
    switch (key) {
      case 'text':
      case 'textSize':
      case 'bold': {
        view.text = get('text') ?? ''
        view.textStyle = { size: get('textSize') ?? 'm', bold: get('bold') ?? false }
        const size = measureNode(view.text, view.textStyle)
        const changed = size.width !== view.width || size.height !== view.height
        view.width = size.width
        view.height = size.height
        view.textLines = size.lines
        return changed
      }
      case 'parentId':
        view.parentId = get('parentId') ?? null
        return true
      case 'color':
        view.color = get('color') ?? null
        return false // effectiveColor refreshed in derived pass
      case 'shape':
        view.shape = get('shape') ?? 'pill'
        return false
      case 'connectorStyle':
        view.connectorStyle = get('connectorStyle') ?? null
        return false
      default: {
        if (!STRUCTURAL_FIELDS.has(key) && !TEXT_FIELDS.has(key)) return false
        view.order = get('order') ?? view.order
        view.collapsed = get('collapsed') ?? false
        view.layout = get('layout') ?? 'auto'
        view.mx = get('mx') ?? 0
        view.my = get('my') ?? 0
        view.side = get('side') ?? null
        view.dir = get('dir') ?? null
        return true
      }
    }
  }

  private buildView(id: string, m: Y.Map<unknown>): NodeView {
    const get = <T>(k: string): T => m.get(k) as T
    const textStyle = {
      size: get<'s' | 'm' | 'l'>('textSize') ?? 'm',
      bold: get<boolean>('bold') ?? false,
    }
    const text = get<string>('text') ?? ''
    const size = measureNode(text, textStyle)
    return {
      id,
      parentId: get('parentId') ?? null,
      order: get('order') ?? '',
      text,
      shape: get('shape') ?? 'pill',
      color: get('color') ?? null,
      textStyle,
      collapsed: get('collapsed') ?? false,
      layout: get('layout') ?? 'auto',
      mx: get('mx') ?? 0,
      my: get('my') ?? 0,
      side: get('side') ?? null,
      dir: get('dir') ?? null,
      connectorStyle: get('connectorStyle') ?? null,
      childrenIds: [],
      depth: 0,
      effectiveColor: ROOT_DEFAULT_COLOR,
      width: size.width,
      height: size.height,
      textLines: size.lines,
      x: 0,
      y: 0,
      renderX: 0,
      renderY: 0,
      renderAlpha: 1,
      renderScale: 1,
      subtreeBounds: { x: 0, y: 0, w: 0, h: 0 },
      subtreeCount: 0,
      visible: true,
      vanishing: false,
    }
  }

  private beginExit(view: NodeView): void {
    this.animator.cancel(view.id)
    if (!view.visible && !view.vanishing) return // hidden under collapse: vanish silently
    view.vanishing = true
    this.exiting.push(view)
    this.animator.tweenTo(view, { alpha: 0, scale: 0.85 }, EXIT_TWEEN_MS, () => {
      const i = this.exiting.indexOf(view)
      if (i >= 0) this.exiting.splice(i, 1)
      this.onUpdate()
    })
  }

  // ------------------------------------------------------- derived rebuilds

  /** Rebuild childrenIds / depth / visibility / colors / counts for all nodes. */
  private rebuildDerived(): void {
    const prevVisible = new Map<string, boolean>()
    for (const [id, n] of this.nodes) {
      prevVisible.set(id, n.visible)
      n.childrenIds.length = 0
    }
    const roots: NodeView[] = []
    for (const n of this.nodes.values()) {
      if (n.parentId === null || !this.nodes.has(n.parentId)) {
        roots.push(n)
      } else {
        this.nodes.get(n.parentId)!.childrenIds.push(n.id)
      }
    }
    roots.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    this.rootIds = roots.map((r) => r.id)

    const byOrder = (a: string, b: string): number => {
      const oa = this.nodes.get(a)!.order
      const ob = this.nodes.get(b)!.order
      return oa < ob ? -1 : oa > ob ? 1 : 0
    }

    this.paintList.length = 0
    const walk = (n: NodeView, depth: number, color: string, hidden: boolean): number => {
      n.depth = depth
      n.effectiveColor = n.color ?? color
      n.visible = !hidden
      n.childrenIds.sort(byOrder)
      this.paintList.push(n.id)
      let count = 0
      for (const cid of n.childrenIds) {
        const c = this.nodes.get(cid)!
        count += 1 + walk(c, depth + 1, n.effectiveColor, hidden || n.collapsed)
      }
      n.subtreeCount = count
      return count
    }
    for (const r of roots) walk(r, 0, ROOT_DEFAULT_COLOR, false)

    // visibility transitions → collapse/expand animations
    for (const [id, wasVisible] of prevVisible) {
      const n = this.nodes.get(id)
      if (!n) continue
      if (wasVisible && !n.visible) {
        // collapse: shrink into the nearest visible ancestor
        const anchor = this.nearestVisibleAncestor(n)
        n.vanishing = true
        this.animator.tweenTo(
          n,
          { x: anchor?.x ?? n.x, y: anchor?.y ?? n.y, alpha: 0, scale: 0.85 },
          EXIT_TWEEN_MS,
          () => {
            n.vanishing = false
            this.onUpdate()
          },
        )
        this.spatial.remove(id)
      } else if (!wasVisible && n.visible) {
        // expand: grow out of the nearest visible ancestor (position set post-layout)
        const anchor = this.nearestVisibleAncestor(n)
        if (anchor) {
          n.renderX = anchor.renderX
          n.renderY = anchor.renderY
        }
        n.renderAlpha = 0
        n.renderScale = 0.85
        n.vanishing = false
      }
    }
  }

  private nearestVisibleAncestor(n: NodeView): NodeView | null {
    let cur = n.parentId ? this.nodes.get(n.parentId) : undefined
    while (cur && !cur.visible) cur = cur.parentId ? this.nodes.get(cur.parentId) : undefined
    return cur ?? null
  }

  // ----------------------------------------------------------------- layout

  /**
   * Layout data source, patched while a drag is live: dragged tops vanish
   * from their parents' child lists and a phantom slot (sized like the
   * dragged node) is spliced into the drop candidate — the animated
   * "insertion gap".
   */
  private layoutGetter(): (id: string) => LayoutNodeData | undefined {
    if (this.dragTops.size === 0) return (id) => this.nodes.get(id)
    const preview = this.preview
    const firstTop = this.nodes.get([...this.dragTops][0])
    const phantom: LayoutNodeData | undefined =
      preview && firstTop
        ? {
            id: PHANTOM_ID,
            width: firstTop.width,
            height: firstTop.height,
            childrenIds: [],
            collapsed: false,
            layout: 'auto',
            mx: 0,
            my: 0,
            side: preview.side,
            dir: null,
          }
        : undefined
    return (id) => {
      if (id === PHANTOM_ID) return phantom
      const n = this.nodes.get(id)
      if (!n) return undefined
      const isPreviewParent = preview !== null && id === preview.parentId && phantom !== undefined
      const hasDraggedChild = n.childrenIds.some((c) => this.dragTops.has(c))
      if (!isPreviewParent && !hasDraggedChild) return n
      let kids = hasDraggedChild
        ? n.childrenIds.filter((c) => !this.dragTops.has(c))
        : [...n.childrenIds]
      if (isPreviewParent && preview && !n.collapsed) {
        // preview.index counts the same universe the interaction layer uses:
        // auto-layout children, side-filtered for both-side roots
        const universe = this.insertionUniverse(n.id, preview.side, kids)
        const ref = preview.index < universe.length ? universe[preview.index] : null
        if (ref) {
          const at = kids.indexOf(ref)
          kids = [...kids.slice(0, at), PHANTOM_ID, ...kids.slice(at)]
        } else {
          kids = [...kids, PHANTOM_ID]
        }
      }
      return { ...n, childrenIds: kids }
    }
  }

  /** Re-run layout for the given roots and tween every moved node to its new slot. */
  private relayout(rootIds: Set<string>, enteringIds: Set<string>): void {
    const t0 = performance.now()
    const get = this.layoutGetter()
    this.phantomSlot = null
    for (const rootId of rootIds) {
      const positions = layoutMindmapRoot(rootId, get, this.spacing)
      for (const [id, p] of positions) {
        if (id === PHANTOM_ID) {
          this.phantomSlot = { x: p.x, y: p.y }
          continue
        }
        const n = this.nodes.get(id)
        if (!n) continue
        const moved = Math.abs(n.x - p.x) > 0.01 || Math.abs(n.y - p.y) > 0.01
        n.x = p.x
        n.y = p.y
        if (this.immediateIds?.has(id)) {
          this.animator.cancel(id)
          n.renderX = p.x
          n.renderY = p.y
          n.renderAlpha = 1
          n.renderScale = 1
        } else if (enteringIds.has(id)) {
          // new node: pop in from the parent's current position
          const parent = n.parentId ? this.nodes.get(n.parentId) : undefined
          n.renderX = parent ? parent.renderX : p.x
          n.renderY = parent ? parent.renderY : p.y
          this.animator.tweenTo(n, { x: p.x, y: p.y, alpha: 1, scale: 1 }, ENTER_TWEEN_MS)
        } else if (n.visible && (moved || n.renderAlpha < 1)) {
          this.animator.tweenTo(n, { x: p.x, y: p.y, alpha: 1, scale: 1 })
        } else if (!n.visible && !n.vanishing) {
          n.renderX = p.x
          n.renderY = p.y
        }
      }
    }
    this.lastLayoutMs = performance.now() - t0
    this.refreshSubtreeBoundsAndSpatial()
  }

  /** Recompute subtree bounds (from slot positions) and the spatial index. */
  private refreshSubtreeBoundsAndSpatial(): void {
    const visit = (id: string): Rect | null => {
      const n = this.nodes.get(id)
      if (!n) return null
      let bounds: Rect | null = n.visible ? nodeLayoutRect(n) : null
      for (const cid of n.childrenIds) {
        const cb = visit(cid)
        if (cb) bounds = bounds ? rectUnion(bounds, cb) : cb
      }
      n.subtreeBounds = bounds ?? nodeLayoutRect(n)
      if (n.visible) this.spatial.update(n.id, nodeLayoutRect(n))
      else this.spatial.remove(n.id)
      return n.visible || n.childrenIds.length > 0 ? n.subtreeBounds : bounds
    }
    for (const r of this.rootIds) visit(r)
  }

  // ------------------------------------------------------------- full build

  private fullRebuild(): void {
    this.nodes.clear()
    this.spatial.clear()
    this.exiting.length = 0
    this.bd.nodes.forEach((m, id) => {
      this.nodes.set(id, this.buildView(id, m))
    })
    this.rebuildDerived()
    const t0 = performance.now()
    for (const rootId of this.rootIds) {
      const positions = layoutMindmapRoot(rootId, (id) => this.nodes.get(id), this.spacing)
      for (const [id, p] of positions) {
        const n = this.nodes.get(id)
        if (!n) continue
        n.x = p.x
        n.y = p.y
        n.renderX = p.x
        n.renderY = p.y
        n.renderAlpha = 1
        n.renderScale = 1
      }
    }
    this.lastLayoutMs = performance.now() - t0
    // nodes hidden under collapse never got positions: park them at their anchor
    for (const n of this.nodes.values()) {
      if (!n.visible) {
        const anchor = this.nearestVisibleAncestor(n)
        if (anchor) {
          n.x = anchor.x
          n.y = anchor.y
          n.renderX = anchor.x
          n.renderY = anchor.y
        }
      }
    }
    this.refreshSubtreeBoundsAndSpatial()
    this.rebuildLinks()
    this.version++
  }

  private rebuildLinks(): void {
    const out: LinkView[] = []
    this.bd.links.forEach((m) => {
      out.push({
        id: m.get('id') as string,
        fromId: m.get('fromId') as string,
        toId: m.get('toId') as string,
        label: (m.get('label') as string) ?? '',
        style: ((m.get('style') as string) ?? 'solid') as LinkView['style'],
        arrow: ((m.get('arrow') as string) ?? 'end') as LinkView['arrow'],
      })
    })
    this.links = out
    this.bump()
  }
}

/** Side of the root a (possibly deep) node belongs to, per current slots. */
export function sideOfNode(mirror: Mirror, id: string): Side {
  let cur = mirror.nodes.get(id)
  while (cur && cur.parentId !== null) {
    const p = mirror.nodes.get(cur.parentId)
    if (!p) break
    if (p.parentId === null) return cur.side ?? 'right'
    cur = p
  }
  return 'right'
}
