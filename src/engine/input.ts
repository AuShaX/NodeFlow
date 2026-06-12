import type { Point } from '../types'
import type { InteractionMachine } from './interactions'

/**
 * Wires DOM events on the canvas (and window, for keyboard) into the
 * interaction machine. Returns a cleanup function.
 */
export function attachInput(canvas: HTMLCanvasElement, machine: InteractionMachine): () => void {
  const pos = (e: MouseEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // --- touch pinch (SPEC §7): two fingers zoom around the midpoint and pan.
  // Tracked here so the interaction machine stays single-pointer; the second
  // finger cancels any in-flight gesture, and fingers surviving a pinch are
  // swallowed until lifted (no post-pinch jump).
  const touchPoints = new Map<number, Point>()
  let pinchIds: [number, number] | null = null
  let prevMid: Point | null = null
  let prevDist = 0
  const swallowUntilLift = new Set<number>()

  const pinchPair = (): [Point, Point] | null => {
    if (!pinchIds) return null
    const a = touchPoints.get(pinchIds[0])
    const b = touchPoints.get(pinchIds[1])
    return a && b ? [a, b] : null
  }

  const onPointerDown = (e: PointerEvent) => {
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // synthetic events (tests) have no active pointer to capture
    }
    if (e.pointerType === 'touch') {
      touchPoints.set(e.pointerId, pos(e))
      if (pinchIds) return // third+ finger: ignore
      if (touchPoints.size === 2) {
        machine.cancelGesture()
        pinchIds = [...touchPoints.keys()] as [number, number]
        const [a, b] = pinchPair()!
        prevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        prevDist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
        return
      }
    }
    machine.onPointerDown(pos(e), e)
    if (e.button === 1) e.preventDefault() // no middle-click autoscroll
  }
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (touchPoints.has(e.pointerId)) touchPoints.set(e.pointerId, pos(e))
      if (pinchIds) {
        if (!pinchIds.includes(e.pointerId)) return
        const pair = pinchPair()
        if (!pair || !prevMid) return
        const [a, b] = pair
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
        machine.pinchBy(mid, dist / prevDist, mid.x - prevMid.x, mid.y - prevMid.y)
        prevMid = mid
        prevDist = dist
        return
      }
      if (swallowUntilLift.has(e.pointerId)) return
    }
    machine.onPointerMove(pos(e), e)
  }
  const endTouch = (e: PointerEvent): boolean => {
    // returns true when the event was consumed by pinch bookkeeping
    if (e.pointerType !== 'touch') return false
    touchPoints.delete(e.pointerId)
    if (pinchIds?.includes(e.pointerId)) {
      pinchIds = null
      prevMid = null
      for (const id of touchPoints.keys()) swallowUntilLift.add(id)
      return true
    }
    if (swallowUntilLift.delete(e.pointerId)) return true
    return false
  }
  const onPointerUp = (e: PointerEvent) => {
    if (endTouch(e)) return
    machine.onPointerUp(pos(e), e)
  }
  const onPointerCancel = (e: PointerEvent) => {
    if (endTouch(e)) return
    machine.onPointerCancel(e)
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault() // the canvas owns all scrolling
    machine.onWheel(pos(e), e)
  }
  const onDblClick = (e: MouseEvent) => machine.onDoubleClick(pos(e), e)
  const onContextMenu = (e: Event) => e.preventDefault()

  const editableTarget = (e: KeyboardEvent): boolean => {
    const t = e.target
    if (!(t instanceof HTMLElement)) return false
    // chrome owns its own keys (buttons, menus, panels are marked data-chrome)
    if (t.closest('[data-chrome]')) return true
    return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (editableTarget(e)) return
    machine.onKeyDown(e)
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (editableTarget(e)) return
    machine.onKeyUp(e)
  }
  const onBlur = () => machine.onWindowBlur()

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('dblclick', onDblClick)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('dblclick', onDblClick)
    canvas.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}
