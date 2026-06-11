import type { Point, SceneSource } from '../types'
import type { Camera } from './camera'
import { centerOn, fitBounds, panByScreen, screenToWorld, zoomAtPoint } from './camera'
import type { Renderer } from './renderer'
import type { Animator } from './animator'
import { hitTestNode } from './hitTest'
import { clearSelection, setSelection, toggleSelected, uiStore } from '../state/store'

/**
 * Explicit interaction state machine (SPEC §9). M1 implements idle / panning
 * / spacePan plus wheel pan-zoom and click selection; drag states arrive in
 * M3, editing in M2.
 */
type InteractionState =
  | { kind: 'idle' }
  | {
      kind: 'panning'
      pointerId: number
      lastX: number
      lastY: number
      via: 'space' | 'middle' | 'empty'
      moved: boolean
    }
  | { kind: 'pressingNode'; pointerId: number; nodeId: string; startX: number; startY: number }

export interface EngineHost {
  canvas: HTMLCanvasElement
  scene: SceneSource
  renderer: Renderer
  animator: Animator
}

export class InteractionMachine {
  state: InteractionState = { kind: 'idle' }
  private host: EngineHost

  constructor(host: EngineHost) {
    this.host = host
  }

  // ------------------------------------------------------------ pointer

  onPointerDown(pos: Point, e: PointerEvent): void {
    if (this.state.kind !== 'idle') return // ignore extra pointers for now
    const middle = e.button === 1
    const left = e.button === 0
    if (!middle && !left) return

    if (middle || uiStore.getState().spaceDown) {
      this.state = {
        kind: 'panning',
        pointerId: e.pointerId,
        lastX: pos.x,
        lastY: pos.y,
        via: middle ? 'middle' : 'space',
        moved: false,
      }
      this.applyCursor()
      return
    }

    const world = screenToWorld(this.camera, pos.x, pos.y)
    const hitNode = hitTestNode(this.host.scene, world)
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
      }
      this.repaint()
      return
    }

    // Empty canvas: drag pans (marquee replaces this in M3).
    this.state = {
      kind: 'panning',
      pointerId: e.pointerId,
      lastX: pos.x,
      lastY: pos.y,
      via: 'empty',
      moved: false,
    }
    this.applyCursor()
  }

  onPointerMove(pos: Point, e: PointerEvent): void {
    const st = this.state
    switch (st.kind) {
      case 'idle': {
        const world = screenToWorld(this.camera, pos.x, pos.y)
        const hit = hitTestNode(this.host.scene, world)
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
        if (Math.abs(dx) + Math.abs(dy) > 0) st.moved = true
        // Content follows the cursor: dragging right moves the camera left.
        this.setCamera(panByScreen(this.camera, -dx, -dy))
        return
      }
      case 'pressingNode':
        // Node dragging lands in M3; pressing is inert beyond selection.
        return
    }
  }

  onPointerUp(pos: Point, e: PointerEvent): void {
    const st = this.state
    if (st.kind === 'panning' && e.pointerId === st.pointerId) {
      const wasClick = !st.moved && st.via === 'empty'
      this.state = { kind: 'idle' }
      if (wasClick) clearSelection()
      this.applyCursor()
      this.repaint()
      return
    }
    if (st.kind === 'pressingNode' && e.pointerId === st.pointerId) {
      this.state = { kind: 'idle' }
      this.applyCursor()
      return
    }
    void pos
  }

  onPointerCancel(e: PointerEvent): void {
    const st = this.state
    if (st.kind !== 'idle' && 'pointerId' in st && st.pointerId === e.pointerId) {
      this.state = { kind: 'idle' }
      this.applyCursor()
      this.repaint()
    }
  }

  // -------------------------------------------------------------- wheel

  onWheel(pos: Point, e: WheelEvent): void {
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
    if (e.code === 'Space' && !e.repeat) {
      uiStore.setState({ spaceDown: true })
      this.applyCursor()
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
    if (e.key === 'Escape') {
      clearSelection()
      this.repaint()
    }
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      uiStore.setState({ spaceDown: false })
      this.applyCursor()
    }
  }

  onWindowBlur(): void {
    uiStore.setState({ spaceDown: false })
    if (this.state.kind === 'panning') this.state = { kind: 'idle' }
    this.applyCursor()
  }

  // ------------------------------------------------------------ actions

  fitToContent(): void {
    const bounds = this.host.scene.contentBounds()
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

  private applyCursor(): void {
    const st = this.state
    let cursor = 'default'
    if (st.kind === 'panning') cursor = 'grabbing'
    else if (uiStore.getState().spaceDown) cursor = 'grab'
    this.host.canvas.style.cursor = cursor
  }
}

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
