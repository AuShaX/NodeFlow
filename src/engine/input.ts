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

  const onPointerDown = (e: PointerEvent) => {
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // synthetic events (tests) have no active pointer to capture
    }
    machine.onPointerDown(pos(e), e)
    if (e.button === 1) e.preventDefault() // no middle-click autoscroll
  }
  const onPointerMove = (e: PointerEvent) => machine.onPointerMove(pos(e), e)
  const onPointerUp = (e: PointerEvent) => machine.onPointerUp(pos(e), e)
  const onPointerCancel = (e: PointerEvent) => machine.onPointerCancel(e)
  const onWheel = (e: WheelEvent) => {
    e.preventDefault() // the canvas owns all scrolling
    machine.onWheel(pos(e), e)
  }
  const onDblClick = (e: MouseEvent) => machine.onDoubleClick(pos(e), e)
  const onContextMenu = (e: Event) => e.preventDefault()

  const editableTarget = (e: KeyboardEvent): boolean => {
    const t = e.target
    if (!(t instanceof HTMLElement)) return false
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
