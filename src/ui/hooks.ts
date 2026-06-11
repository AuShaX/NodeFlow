import { useEffect, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { engineRef } from '../engine'

/**
 * Re-render chrome whenever the doc mirror updates. Components read mirror
 * data directly during render; the returned version is the change signal.
 * (The engine mounts before chrome subscribes — Board precedes chrome in App.)
 */
export function useMirrorVersion(): number {
  return useSyncExternalStore(subscribeMirror, getMirrorVersion)
}

const subscribeMirror = (cb: () => void): (() => void) =>
  engineRef.current?.board.mirror.subscribe(cb) ?? (() => {})

const getMirrorVersion = (): number => engineRef.current?.board.mirror.version ?? -1

/**
 * Floating chrome sits over the canvas; forward its wheel events so pan/zoom
 * has no dead zones. Non-passive on purpose: trackpad pinch (ctrl+wheel) must
 * not zoom the page.
 */
export function useForwardWheel(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const engine = engineRef.current
      if (!engine) return
      e.preventDefault()
      const rect = engine.canvas.getBoundingClientRect()
      engine.machine.onWheel({ x: e.clientX - rect.left, y: e.clientY - rect.top }, e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}

/** Close popovers/menus on outside pointerdown or Escape. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [ref, onClose, open])
}
