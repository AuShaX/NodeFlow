import type { NodeView, Point, Rect, Side } from '../types'
import { nodeRenderRect, rectsIntersect } from '../types'
import type { Camera } from './camera'
import { centerOn, fitBounds, panByScreen, screenToWorld, zoomAtPoint } from './camera'
import type { Renderer } from './renderer'
import type { Animator } from './animator'
import type { BoardActions } from './actions'
import type { Board } from '../doc/board'
import type { DragPreview } from '../doc/mirror'
import { hitTestLink, hitTestNode, nearestNode } from './hitTest'
import { affordanceAt, drawNode } from './drawNode'
import { anchorOnBox, drawTreeConnector } from './drawConnector'
import { COLORS } from '../theme'
import {
  clearSelection,
  hideContextMenu,
  setLinkSelection,
  setSelection,
  setTool,
  showContextMenu,
  toggleSelected,
  uiStore,
} from '../state/store'

const DRAG_THRESHOLD_PX = 4
const CANDIDATE_RADIUS_PX = 80

/**
 * Explicit interaction state machine (SPEC §9): idle, panning, marquee,
 * draggingNodes (ghost + live insertion-gap preview), draggingFreeMove,
 * spacePan via flag, plus the keyboard layer.
 */
type InteractionState =
  | { kind: 'idle' }
  | {
      kind: 'panning'
      pointerId: number
      lastX: number
      lastY: number
      via: 'space' | 'middle'
    }
  | {
      kind: 'pressingNode'
      pointerId: number
      nodeId: string
      startX: number
      startY: number
      ctrl: boolean
      alt: boolean
    }
  | { kind: 'pressingEmpty'; pointerId: number; startX: number; startY: number; shift: boolean }
  | {
      kind: 'marquee'
      pointerId: number
      startWorld: Point
      curWorld: Point
      base: ReadonlySet<string>
    }
  | {
      kind: 'draggingNodes'
      pointerId: number
      topIds: string[]
      grabWorld: Point
      dx: number
      dy: number
      preview: DragPreview | null
    }
  | {
      kind: 'draggingFreeMove'
      pointerId: number
      nodeId: string
      isRoot: boolean
      grabWorld: Point
      start: { mx: number; my: number; layout: 'auto' | 'manual' }
      last: { mx: number; my: number }
    }
  | { kind: 'draggingLink'; pointerId: number; fromId: string; curWorld: Point }

export interface EngineHost {
  canvas: HTMLCanvasElement
  board: Board
  renderer: Renderer
  animator: Animator
  actions: BoardActions
}

export class InteractionMachine {
  state: InteractionState = { kind: 'idle' }
  private host: EngineHost

  constructor(host: EngineHost) {
    this.host = host
  }

  private get scene() {
    return this.host.board.mirror
  }

  // ------------------------------------------------------------ pointer

  onPointerDown(pos: Point, e: PointerEvent): void {
    if (this.state.kind !== 'idle') return // ignore extra pointers for now
    const right = e.button === 2
    const middle = e.button === 1
    const left = e.button === 0
    if (!right && !middle && !left) return

    if (uiStore.getState().editing) return // editor overlay owns the pointer until blur
    hideContextMenu() // any fresh canvas press dismisses an open menu

    // Right-click: select the target and open its context menu.
    if (right) {
      const world = screenToWorld(this.camera, pos.x, pos.y)
      const hitNode = hitTestNode(this.scene, world)
      if (hitNode) {
        if (!uiStore.getState().selection.has(hitNode.id)) setSelection([hitNode.id])
        showContextMenu({ x: pos.x, y: pos.y, targetId: hitNode.id, targetType: 'node' })
        this.repaint()
        return
      }
      const hitLink = hitTestLink(this.scene, world, this.camera.zoom)
      if (hitLink) {
        setLinkSelection(hitLink.id)
        showContextMenu({ x: pos.x, y: pos.y, targetId: hitLink.id, targetType: 'link' })
        this.repaint()
        return
      }
      // right-click on empty = no menu
      return
    }

    if (middle || uiStore.getState().spaceDown) {
      this.state = {
        kind: 'panning',
        pointerId: e.pointerId,
        lastX: pos.x,
        lastY: pos.y,
        via: middle ? 'middle' : 'space',
      }
      this.syncUi()
      return
    }

    const world = screenToWorld(this.camera, pos.x, pos.y)

    // Active tool (bottom toolbar) takes the press before normal selection.
    const tool = uiStore.getState().tool
    if (tool === 'addRoot') {
      setTool('select')
      this.host.actions.addRootAt(world.x, world.y)
      this.syncUi()
      return
    }
    if (tool === 'link') {
      const from = hitTestNode(this.scene, world)
      if (from) {
        this.state = {
          kind: 'draggingLink',
          pointerId: e.pointerId,
          fromId: from.id,
          curWorld: world,
        }
      } else {
        setTool('select') // clicking empty cancels the tool
      }
      this.syncUi()
      this.repaint()
      return
    }

    // Affordances (collapse badge / +/– / link dot) take priority over bodies.
    const affordance = this.affordanceUnderPointer(world)
    if (affordance) {
      const { node, kind } = affordance
      if (kind === 'badge' || kind === 'minus') {
        this.host.actions.toggleCollapse(node.id)
      } else if (kind === 'plus') {
        setSelection([node.id])
        this.host.actions.addChild(node.id)
      } else if (kind === 'linkdot') {
        this.state = {
          kind: 'draggingLink',
          pointerId: e.pointerId,
          fromId: node.id,
          curWorld: world,
        }
        this.syncUi()
      }
      this.repaint()
      return
    }

    const hitNode = hitTestNode(this.scene, world)
    if (hitNode) {
      // Select on press, like Miro. Shift toggles into multi-selection.
      if (e.shiftKey) toggleSelected(hitNode.id)
      else if (!uiStore.getState().selection.has(hitNode.id)) setSelection([hitNode.id])
      this.state = {
        kind: 'pressingNode',
        pointerId: e.pointerId,
        nodeId: hitNode.id,
        startX: pos.x,
        startY: pos.y,
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey,
      }
      this.syncUi()
      this.repaint()
      return
    }

    const hitLink = hitTestLink(this.scene, world, this.camera.zoom)
    if (hitLink) {
      setLinkSelection(hitLink.id)
      this.repaint()
      this.state = { kind: 'idle' }
      return
    }

    this.state = {
      kind: 'pressingEmpty',
      pointerId: e.pointerId,
      startX: pos.x,
      startY: pos.y,
      shift: e.shiftKey,
    }
    this.syncUi()
  }

  onPointerMove(pos: Point, e: PointerEvent): void {
    const st = this.state
    switch (st.kind) {
      case 'idle': {
        const world = screenToWorld(this.camera, pos.x, pos.y)
        const hit = hitTestNode(this.scene, world)
        const hover = hit ? hit.id : null
        if (uiStore.getState().hover !== hover) {
          uiStore.setState({ hover })
          this.repaint()
        }
        return
      }
      case 'panning': {
        if (e.pointerId !== st.pointerId) return
        const dx = pos.x - st.lastX
        const dy = pos.y - st.lastY
        if (dx === 0 && dy === 0) return
        st.lastX = pos.x
        st.lastY = pos.y
        this.setCamera(panByScreen(this.camera, -dx, -dy))
        return
      }
      case 'pressingNode': {
        if (e.pointerId !== st.pointerId) return
        if (Math.hypot(pos.x - st.startX, pos.y - st.startY) < DRAG_THRESHOLD_PX) return
        this.startNodeDrag(st, pos)
        return
      }
      case 'pressingEmpty': {
        if (e.pointerId !== st.pointerId) return
        if (Math.hypot(pos.x - st.startX, pos.y - st.startY) < DRAG_THRESHOLD_PX) return
        const startWorld = screenToWorld(this.camera, st.startX, st.startY)
        this.state = {
          kind: 'marquee',
          pointerId: st.pointerId,
          startWorld,
          curWorld: screenToWorld(this.camera, pos.x, pos.y),
          base: st.shift ? uiStore.getState().selection : new Set(),
        }
        this.syncUi()
        this.updateMarquee()
        return
      }
      case 'marquee': {
        if (e.pointerId !== st.pointerId) return
        st.curWorld = screenToWorld(this.camera, pos.x, pos.y)
        this.updateMarquee()
        return
      }
      case 'draggingNodes': {
        if (e.pointerId !== st.pointerId) return
        const world = screenToWorld(this.camera, pos.x, pos.y)
        st.dx = world.x - st.grabWorld.x
        st.dy = world.y - st.grabWorld.y
        st.preview = this.findDropPreview(world, st.topIds)
        this.scene.setDragPreview(st.preview)
        this.repaint()
        return
      }
      case 'draggingFreeMove': {
        if (e.pointerId !== st.pointerId) return
        const world = screenToWorld(this.camera, pos.x, pos.y)
        const mx = st.start.mx + (world.x - st.grabWorld.x)
        const my = st.start.my + (world.y - st.grabWorld.y)
        st.last = { mx, my }
        this.host.actions.freeMoveLive(st.nodeId, mx, my, st.isRoot)
        return
      }
      case 'draggingLink': {
        if (e.pointerId !== st.pointerId) return
        st.curWorld = screenToWorld(this.camera, pos.x, pos.y)
        this.repaint()
        return
      }
    }
  }

  onPointerUp(pos: Point, e: PointerEvent): void {
    const st = this.state
    if ('pointerId' in st && st.pointerId !== e.pointerId) return
    switch (st.kind) {
      case 'panning':
        this.state = { kind: 'idle' }
        break
      case 'pressingNode':
        this.state = { kind: 'idle' }
        break
      case 'pressingEmpty':
        this.state = { kind: 'idle' }
        clearSelection()
        break
      case 'marquee':
        this.state = { kind: 'idle' }
        break
      case 'draggingNodes':
        this.finishNodeDrag(st, false)
        break
      case 'draggingFreeMove':
        this.scene.setImmediate(null)
        this.host.actions.freeMoveCommit(st.nodeId, st.start, st.last, st.isRoot)
        this.state = { kind: 'idle' }
        break
      case 'draggingLink': {
        const target = hitTestNode(this.scene, st.curWorld)
        if (target && target.id !== st.fromId) {
          this.host.actions.createCrossLink(st.fromId, target.id)
        }
        if (uiStore.getState().tool === 'link') setTool('select') // one link per activation
        this.state = { kind: 'idle' }
        break
      }
      default:
        return
    }
    void pos
    this.syncUi()
    this.repaint()
  }

  onPointerCancel(e: PointerEvent): void {
    const st = this.state
    if (st.kind === 'idle' || !('pointerId' in st) || st.pointerId !== e.pointerId) return
    this.abortGesture()
  }

  onDoubleClick(pos: Point, e: MouseEvent): void {
    if (e.button !== 0 || uiStore.getState().editing) return
    const world = screenToWorld(this.camera, pos.x, pos.y)
    const hit = hitTestNode(this.scene, world)
    if (hit) {
      setSelection([hit.id])
      this.host.actions.startEdit(hit.id, null)
      return
    }
    const link = hitTestLink(this.scene, world, this.camera.zoom)
    if (link) {
      setLinkSelection(link.id)
      uiStore.setState({ editingLinkId: link.id })
      return
    }
    // Double-click on empty canvas: new floating root, edit immediately.
    this.host.actions.addRootAt(world.x, world.y)
  }

  /** Affordance under the pointer on the hovered/selected nodes (+ any collapsed badge nearby). */
  private affordanceUnderPointer(
    world: Point,
  ): { node: NodeView; kind: ReturnType<typeof affordanceAt> & string } | null {
    const ui = uiStore.getState()
    const active = new Set<string>()
    if (ui.hover) active.add(ui.hover)
    if (ui.selection.size === 1) active.add([...ui.selection][0])
    // collapsed badges are always live: probe nearby nodes
    const probe = 40
    for (const id of this.scene.spatial.queryRect({
      x: world.x - probe,
      y: world.y - probe,
      w: probe * 2,
      h: probe * 2,
    })) {
      const n = this.scene.nodes.get(id)
      if (n && n.visible && n.collapsed && n.subtreeCount > 0) active.add(id)
    }
    for (const id of active) {
      const n = this.scene.nodes.get(id)
      if (!n || !n.visible) continue
      const kind = affordanceAt(
        n,
        this.scene.outwardSide(id),
        world,
        ui.hover === id || ui.selection.has(id),
      )
      if (kind) return { node: n, kind }
    }
    return null
  }

  // --------------------------------------------------------- node drags

  private startNodeDrag(st: Extract<InteractionState, { kind: 'pressingNode' }>, pos: Point): void {
    const grabWorld = screenToWorld(this.camera, st.startX, st.startY)
    const node = this.scene.nodes.get(st.nodeId)
    if (!node) {
      this.state = { kind: 'idle' }
      return
    }

    // Ctrl/Cmd+drag → free-move (manual offset; roots just move).
    if (st.ctrl || node.parentId === null) {
      const isRoot = node.parentId === null
      const subtree = new Set<string>()
      const collect = (id: string): void => {
        subtree.add(id)
        const n = this.scene.nodes.get(id)
        if (n) for (const c of n.childrenIds) collect(c)
      }
      collect(node.id)
      this.scene.setImmediate(subtree)
      const start = isRoot
        ? { mx: node.mx, my: node.my, layout: node.layout }
        : node.layout === 'manual'
          ? { mx: node.mx, my: node.my, layout: 'manual' as const }
          : {
              // entering manual mode: current offset from the parent's slot
              mx: node.x - (this.scene.nodes.get(node.parentId!)?.x ?? 0),
              my: node.y - (this.scene.nodes.get(node.parentId!)?.y ?? 0),
              layout: 'auto' as const,
            }
      this.state = {
        kind: 'draggingFreeMove',
        pointerId: st.pointerId,
        nodeId: node.id,
        isRoot,
        grabWorld,
        start: { mx: start.mx, my: start.my, layout: start.layout },
        last: { mx: start.mx, my: start.my },
      }
      this.syncUi()
      this.onPointerMove(pos, { pointerId: st.pointerId } as PointerEvent)
      return
    }

    // Alt+drag → duplicate the subtree, drag the copy.
    let topIds = this.dragTopsFor(st.nodeId)
    if (st.alt) topIds = this.host.actions.duplicateForDrag(topIds)
    if (topIds.length === 0) {
      this.state = { kind: 'idle' }
      return
    }

    this.scene.beginDrag(topIds)
    this.state = {
      kind: 'draggingNodes',
      pointerId: st.pointerId,
      topIds,
      grabWorld,
      dx: 0,
      dy: 0,
      preview: null,
    }
    this.syncUi()
    this.repaint()
  }

  /** Selected tops if the pressed node is part of the selection, else just it. */
  private dragTopsFor(nodeId: string): string[] {
    const selection = uiStore.getState().selection
    const tops = selection.has(nodeId) ? this.host.actions.selectionTops() : [nodeId]
    return tops.filter((id) => {
      const n = this.scene.nodes.get(id)
      return n && n.parentId !== null // roots use the free-move path
    })
  }

  private finishNodeDrag(
    st: Extract<InteractionState, { kind: 'draggingNodes' }>,
    cancelled: boolean,
  ): void {
    // Park render positions at the ghost so the reflow tweens from there.
    for (const id of this.scene.draggingIds) {
      const n = this.scene.nodes.get(id)
      if (!n) continue
      n.renderX += st.dx
      n.renderY += st.dy
    }
    const preview = cancelled ? null : st.preview
    this.scene.endDrag()
    if (preview) {
      this.host.actions.dropSubtrees(st.topIds, preview.parentId, preview.index, preview.side)
    }
    this.state = { kind: 'idle' }
  }

  /**
   * Drop candidate under the pointer (SPEC §9): the node we'd become a child
   * of, with the insertion index among its children. Hovering a node targets
   * it directly; hovering its sibling column targets the parent; nothing
   * within range → no preview (revert on drop).
   */
  private findDropPreview(world: Point, topIds: string[]): DragPreview | null {
    const exclude = this.scene.draggingIds
    const zoom = this.camera.zoom
    const direct = hitTestNode(this.scene, world, 2, exclude)
    const near = direct ?? nearestNode(this.scene, world, CANDIDATE_RADIUS_PX / zoom, exclude)
    if (!near) return null

    let parent: NodeView | null
    if (direct || near.parentId === null) {
      parent = near
    } else {
      // beyond the node's outward edge → into its children; otherwise sibling
      const rootId = this.scene.rootOf(near.id)
      const root = this.scene.nodes.get(rootId)
      const down = root?.dir === 'down'
      const r = nodeRenderRect(near)
      if (down) {
        parent = world.y > r.y + r.h ? near : (this.scene.nodes.get(near.parentId) ?? near)
      } else {
        const onLeft = near.renderX < (root?.renderX ?? 0)
        const outward = onLeft ? world.x < r.x : world.x > r.x + r.w
        parent = outward ? near : (this.scene.nodes.get(near.parentId) ?? near)
      }
    }
    if (!parent || exclude.has(parent.id)) return null
    // dropping a node onto its own current parent at the same spot is fine —
    // the commit path turns it into a reorder

    const isBothRoot = parent.parentId === null && (parent.dir ?? 'both') === 'both'
    const side: Side | null = isBothRoot
      ? world.x >= parent.renderX
        ? 'right'
        : 'left'
      : parent.parentId === null
        ? null
        : (this.scene.nodes.get(this.scene.rootOf(parent.id))?.dir ?? 'both') === 'both'
          ? this.sideOfBranch(parent.id)
          : null

    // Insertion index: count universe children whose cross-coordinate
    // precedes the pointer.
    const universe = this.scene
      .insertionUniverse(parent.id, side)
      .filter((id) => !topIds.includes(id))
    const rootForAxis = this.scene.nodes.get(this.scene.rootOf(parent.id))
    const downAxis = rootForAxis?.dir === 'down'
    let index = 0
    for (const cid of universe) {
      const c = this.scene.nodes.get(cid)
      if (!c) continue
      const coord = downAxis ? c.x : c.y
      const pointerCoord = downAxis ? world.x : world.y
      if (coord < pointerCoord) index++
    }
    return { parentId: parent.id, index, side }
  }

  private sideOfBranch(id: string): Side {
    let cur = this.scene.nodes.get(id)
    while (cur && cur.parentId !== null) {
      const p = this.scene.nodes.get(cur.parentId)
      if (!p) break
      if (p.parentId === null) return cur.side ?? 'right'
      cur = p
    }
    return 'right'
  }

  // -------------------------------------------------------------- marquee

  private updateMarquee(): void {
    const st = this.state
    if (st.kind !== 'marquee') return
    const rect = normRect(st.startWorld, st.curWorld)
    const candidates = this.scene.spatial.queryRect(rect)
    const picked = new Set(st.base)
    for (const id of candidates) {
      const n = this.scene.nodes.get(id)
      if (n && n.visible && rectsIntersect(nodeRenderRect(n), rect)) picked.add(id)
    }
    setSelection(picked)
    this.repaint()
  }

  // ------------------------------------------------------------- overlay

  /** Painted by the renderer after the scene (world-space ctx). */
  paintOverlay(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const st = this.state
    if (st.kind === 'draggingLink') {
      const from = this.scene.nodes.get(st.fromId)
      if (from) {
        const a = anchorOnBox(from, st.curWorld)
        const reach = Math.max(
          24,
          Math.hypot(st.curWorld.x - a.point.x, st.curWorld.y - a.point.y) * 0.35,
        )
        ctx.save()
        ctx.strokeStyle = COLORS.accent
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.85
        ctx.setLineDash([7, 5])
        ctx.beginPath()
        ctx.moveTo(a.point.x, a.point.y)
        ctx.bezierCurveTo(
          a.point.x + a.normal.x * reach,
          a.point.y + a.normal.y * reach,
          st.curWorld.x,
          st.curWorld.y,
          st.curWorld.x,
          st.curWorld.y,
        )
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(st.curWorld.x, st.curWorld.y, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = COLORS.accent
        ctx.fill()
        ctx.restore()
      }
      return
    }
    if (st.kind === 'marquee') {
      const r = normRect(st.startWorld, st.curWorld)
      ctx.save()
      ctx.fillStyle = COLORS.accent
      ctx.globalAlpha = 0.08
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = COLORS.accent
      ctx.lineWidth = 1.5 / cam.zoom
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.restore()
      return
    }
    if (st.kind !== 'draggingNodes') return

    // Candidate parent highlight.
    if (st.preview) {
      const parent = this.scene.nodes.get(st.preview.parentId)
      if (parent) {
        const r = nodeRenderRect(parent)
        const pad = 4 / cam.zoom
        ctx.save()
        ctx.strokeStyle = COLORS.accent
        ctx.lineWidth = 2 / cam.zoom
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 8)
        ctx.stroke()
        ctx.restore()
      }
      // Placeholder outline at the phantom slot.
      const slot = this.scene.phantomSlot
      const top = this.scene.nodes.get(st.topIds[0])
      if (slot && top) {
        ctx.save()
        ctx.strokeStyle = COLORS.accent
        ctx.globalAlpha = 0.45
        ctx.lineWidth = 1.5 / cam.zoom
        ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom])
        ctx.beginPath()
        ctx.roundRect(slot.x - top.width / 2, slot.y - top.height / 2, top.width, top.height, 8)
        ctx.stroke()
        ctx.restore()
      }
    }

    // Ghost subtree at 60% opacity following the cursor.
    ctx.save()
    ctx.translate(st.dx, st.dy)
    const dragged = this.scene.draggingIds
    for (const id of this.scene.paintList) {
      if (!dragged.has(id)) continue
      const n = this.scene.nodes.get(id)
      if (!n || !n.visible) continue
      if (n.parentId && dragged.has(n.parentId)) {
        const parent = this.scene.nodes.get(n.parentId)
        if (parent) drawTreeConnector(ctx, parent, n, 'h', 'curved', 0.6)
      }
      drawNode(ctx, n, {
        zoom: cam.zoom,
        selected: false,
        hovered: false,
        editing: false,
        outward: 'right',
        alpha: 0.6,
      })
    }
    ctx.restore()
  }

  // -------------------------------------------------------------- wheel

  onWheel(pos: Point, e: WheelEvent): void {
    hideContextMenu()
    const cam = this.camera
    if (isZoomGesture(e)) {
      const factor = wheelZoomFactor(e)
      this.setCamera(zoomAtPoint(cam, cam.zoom * factor, pos.x, pos.y))
    } else {
      const scale = e.deltaMode === 1 ? 16 : 1
      this.setCamera(panByScreen(cam, e.deltaX * scale, e.deltaY * scale))
    }
  }

  // ----------------------------------------------------------- keyboard

  onKeyDown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey
    const { actions } = this.host
    const selection = uiStore.getState().selection
    const selectedId = selection.size > 0 ? [...selection][selection.size - 1] : null

    if (e.key === 'Escape') {
      // Peel one layer per press: menu → gesture → tool → selection.
      if (uiStore.getState().contextMenu) {
        hideContextMenu()
      } else if (this.state.kind !== 'idle') {
        this.abortGesture()
      } else if (uiStore.getState().tool !== 'select') {
        setTool('select')
        this.syncUi()
      } else {
        clearSelection()
        this.repaint()
      }
      return
    }
    hideContextMenu() // any other key dismisses an open menu

    if (e.code === 'Space' && !e.repeat) {
      uiStore.setState({ spaceDown: true })
      this.syncUi()
      e.preventDefault()
      return
    }

    // ---- global chords
    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      actions.undo()
      e.preventDefault()
      return
    }
    if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      actions.redo()
      e.preventDefault()
      return
    }
    if (mod && e.key === '0') {
      this.fitToContent()
      e.preventDefault()
      return
    }
    if (mod && e.key === '1') {
      this.zoomTo100()
      e.preventDefault()
      return
    }
    if (mod && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      uiStore.setState({ hudVisible: !uiStore.getState().hudVisible })
      e.preventDefault()
      return
    }
    if (mod && e.key === 'a') {
      setSelection(this.scene.paintList.filter((id) => this.scene.nodes.get(id)?.visible))
      e.preventDefault()
      return
    }
    if (mod && e.key === 'c') {
      actions.copySelection()
      e.preventDefault()
      return
    }
    if (mod && e.key === 'x') {
      actions.cutSelection()
      e.preventDefault()
      return
    }
    if (mod && e.key === 'v') {
      const { w, h } = this.host.renderer.viewportSize
      actions.paste(screenToWorld(this.camera, w / 2, h / 2))
      e.preventDefault()
      return
    }
    if (mod && !e.shiftKey && e.key === 'd') {
      actions.duplicateSelection()
      e.preventDefault()
      return
    }
    if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      actions.reorderSelected(e.key === 'ArrowUp' ? -1 : 1)
      e.preventDefault()
      return
    }

    const linkSel = uiStore.getState().linkSelection
    if (linkSel && (e.key === 'Delete' || e.key === 'Backspace')) {
      actions.deleteLinkById(linkSel)
      e.preventDefault()
      return
    }

    // ---- selected-node commands
    if (!selectedId) return
    if (e.key === 'Tab' && !e.shiftKey) {
      actions.addChild(selectedId)
      e.preventDefault()
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      actions.selectParent()
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      actions.addSiblingAfter(selectedId)
      e.preventDefault()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      actions.deleteSelection()
      e.preventDefault()
      return
    }
    if (e.key === 'F2') {
      actions.startEdit(selectedId, null)
      e.preventDefault()
      return
    }
    if (e.key === '.' || (mod && e.key === '/')) {
      actions.toggleCollapse(selectedId)
      e.preventDefault()
      return
    }
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      actions.navigate(e.key)
      e.preventDefault()
      return
    }
    // Start typing → edit, replacing content (like Miro/Excel).
    if (!mod && !e.altKey && e.key.length === 1 && e.key !== ' ') {
      actions.startEdit(selectedId, e.key)
      e.preventDefault()
      return
    }
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      uiStore.setState({ spaceDown: false })
      this.syncUi()
    }
  }

  onWindowBlur(): void {
    uiStore.setState({ spaceDown: false })
    if (this.state.kind !== 'idle') this.abortGesture()
    this.syncUi()
  }

  /** Cancel any in-flight gesture, reverting drag effects (SPEC §9 Esc). */
  private abortGesture(): void {
    const st = this.state
    if (st.kind === 'draggingNodes') {
      this.finishNodeDrag(st, true)
    } else if (st.kind === 'draggingFreeMove') {
      this.scene.setImmediate(null)
      // restore the pre-drag position (ephemeral; nothing tracked yet)
      this.host.actions.freeMoveLive(st.nodeId, st.start.mx, st.start.my, st.isRoot)
      if (!st.isRoot) {
        this.host.actions.freeMoveCommit(st.nodeId, st.start, st.start, st.isRoot)
      }
    }
    this.state = { kind: 'idle' }
    this.syncUi()
    this.repaint()
  }

  // ------------------------------------------------------------ actions

  fitToContent(): void {
    const bounds = this.scene.contentBounds()
    if (!bounds) return
    const { w, h } = this.host.renderer.viewportSize
    this.setCamera(fitBounds(bounds, w, h))
  }

  zoomTo100(): void {
    const cam = this.camera
    const { w, h } = this.host.renderer.viewportSize
    const center = screenToWorld(cam, w / 2, h / 2)
    this.setCamera(centerOn(center.x, center.y, 1, w, h))
  }

  /** Zoom in/out around the viewport center (chrome zoom buttons). */
  zoomBy(factor: number): void {
    const cam = this.camera
    const { w, h } = this.host.renderer.viewportSize
    this.setCamera(zoomAtPoint(cam, cam.zoom * factor, w / 2, h / 2))
  }

  // ------------------------------------------------------------ helpers

  private get camera(): Camera {
    return uiStore.getState().camera
  }

  private setCamera(cam: Camera): void {
    uiStore.setState({ camera: cam })
    this.repaint()
  }

  private repaint(): void {
    this.host.renderer.requestPaint()
  }

  /** Cursor + gesture mirror, called after every state transition (and on tool changes from chrome). */
  syncUi(): void {
    const st = this.state
    const ui = uiStore.getState()
    let cursor = 'default'
    if (st.kind === 'panning') cursor = 'grabbing'
    else if (st.kind === 'draggingNodes' || st.kind === 'draggingFreeMove') cursor = 'grabbing'
    else if (st.kind === 'marquee' || st.kind === 'draggingLink') cursor = 'crosshair'
    else if (ui.spaceDown) cursor = 'grab'
    else if (ui.tool !== 'select') cursor = 'crosshair'
    this.host.canvas.style.cursor = cursor
    if (ui.gesture !== st.kind) uiStore.setState({ gesture: st.kind })
  }
}

const normRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
})

/** Ctrl/Cmd+wheel (incl. trackpad pinch) and discrete mouse-wheel ticks zoom; everything else pans. */
function isZoomGesture(e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey) return true
  return isDiscreteWheel(e)
}

/**
 * Heuristic: real mouse wheels report line-mode deltas or large integer
 * pixel deltas with no horizontal component; trackpads report small,
 * frequently fractional deltas, often with deltaX. (See DECISIONS.md.)
 */
function isDiscreteWheel(e: WheelEvent): boolean {
  if (e.deltaMode === 1) return true
  return e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)
}

function wheelZoomFactor(e: WheelEvent): number {
  if (isDiscreteWheel(e)) {
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY
    return Math.pow(1.0015, -dy) // SPEC §8
  }
  // Trackpad pinch: small continuous deltas need a stronger curve to feel 1:1.
  return Math.pow(1.0035, -e.deltaY)
}
