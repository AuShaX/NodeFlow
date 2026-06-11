import type { SceneSource } from '../types'
import { Animator } from './animator'
import { Renderer } from './renderer'
import { InteractionMachine } from './interactions'
import { attachInput } from './input'
import { uiStore } from '../state/store'

export interface Engine {
  renderer: Renderer
  animator: Animator
  machine: InteractionMachine
  scene: SceneSource
  destroy(): void
}

/** Reference to the live engine for chrome components (HUD, toolbar). */
export const engineRef: { current: Engine | null } = { current: null }

/**
 * Composition root: builds renderer + animator + interaction machine around
 * a canvas and a scene, wires input and resize, fits the camera to content.
 */
export function createEngine(canvas: HTMLCanvasElement, scene: SceneSource): Engine {
  const animator = new Animator()
  const renderer = new Renderer(canvas, scene, animator, () => {
    const s = uiStore.getState()
    return { camera: s.camera, selection: s.selection, hover: s.hover, editingId: s.editingId }
  })
  const machine = new InteractionMachine({ canvas, scene, renderer, animator })
  const detachInput = attachInput(canvas, machine)

  // Repaint on any UI-store change (selection from chrome, HUD toggle, ...).
  // The dirty flag makes redundant requests free.
  const unsubscribe = uiStore.subscribe(() => renderer.requestPaint())

  const ro = new ResizeObserver(() => renderer.resize())
  ro.observe(canvas)

  // DPR changes (moving the window between displays) need a backing-store resize.
  let dprQuery: MediaQueryList | null = null
  let dprListener: (() => void) | null = null
  const watchDpr = () => {
    if (dprQuery && dprListener) dprQuery.removeEventListener('change', dprListener)
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprListener = () => {
      renderer.resize()
      watchDpr()
    }
    dprQuery.addEventListener('change', dprListener)
  }
  watchDpr()

  // Initial view: fit the demo content once the canvas has a real size.
  requestAnimationFrame(() => {
    renderer.resize()
    machine.fitToContent()
  })

  const engine: Engine = {
    renderer,
    animator,
    machine,
    scene,
    destroy() {
      engineRef.current = null
      unsubscribe()
      detachInput()
      ro.disconnect()
      if (dprQuery && dprListener) dprQuery.removeEventListener('change', dprListener)
      renderer.destroy()
    },
  }
  engineRef.current = engine
  if (import.meta.env.DEV) {
    // Dev/E2E hook: lets tests read engine state and drive precise interactions.
    ;(window as unknown as Record<string, unknown>).__nodeflow = { engine, uiStore }
  }
  return engine
}
