import * as Y from 'yjs'
import { Animator } from './animator'
import { Renderer } from './renderer'
import { InteractionMachine } from './interactions'
import { BoardActions } from './actions'
import { attachInput } from './input'
import { uiStore } from '../state/store'
import type { Board } from '../doc/board'
import { createBoard } from '../doc/board'

export interface Engine {
  canvas: HTMLCanvasElement
  renderer: Renderer
  animator: Animator
  machine: InteractionMachine
  actions: BoardActions
  board: Board
  destroy(): void
}

/** Reference to the live engine for chrome components (HUD, toolbar, editor overlay). */
export const engineRef: { current: Engine | null } = { current: null }

/**
 * Composition root: animator + board (Yjs doc, mirror, undo) + renderer +
 * interaction machine around a canvas. Data flow per SPEC §4: input →
 * machine → mutation API → observers update mirror → layout → animator →
 * renderer.
 */
export function createEngine(canvas: HTMLCanvasElement, doc: Y.Doc): Engine {
  const animator = new Animator()
  let renderer: Renderer | null = null
  const board = createBoard(animator, () => renderer?.requestPaint(), doc)
  renderer = new Renderer(canvas, board.mirror, animator, () => {
    const s = uiStore.getState()
    return {
      camera: s.camera,
      selection: s.selection,
      linkSelection: s.linkSelection,
      hover: s.hover,
      editingId: s.editing?.id ?? null,
      editingLinkId: s.editingLinkId,
    }
  })
  const actions = new BoardActions(board)
  const machine = new InteractionMachine({ canvas, board, renderer, animator, actions })
  renderer.overlayPainter = (ctx, cam) => machine.paintOverlay(ctx, cam)
  const detachInput = attachInput(canvas, machine)

  // Repaint on any UI-store change (selection from chrome, HUD toggle, ...).
  // The dirty flag makes redundant requests free. Cursor follows tool changes.
  const unsubscribe = uiStore.subscribe((s, prev) => {
    renderer!.requestPaint()
    if (s.tool !== prev.tool) machine.syncUi()
  })

  const ro = new ResizeObserver(() => renderer!.resize())
  ro.observe(canvas)

  // DPR changes (moving the window between displays) need a backing-store resize.
  let dprQuery: MediaQueryList | null = null
  let dprListener: (() => void) | null = null
  const watchDpr = () => {
    if (dprQuery && dprListener) dprQuery.removeEventListener('change', dprListener)
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprListener = () => {
      renderer!.resize()
      watchDpr()
    }
    dprQuery.addEventListener('change', dprListener)
  }
  watchDpr()

  // Initial view: fit the content once the canvas has a real size.
  requestAnimationFrame(() => {
    renderer!.resize()
    machine.fitToContent()
  })

  const engine: Engine = {
    canvas,
    renderer,
    animator,
    machine,
    actions,
    board,
    destroy() {
      engineRef.current = null
      unsubscribe()
      detachInput()
      ro.disconnect()
      if (dprQuery && dprListener) dprQuery.removeEventListener('change', dprListener)
      renderer!.destroy()
      board.destroy()
    },
  }
  engineRef.current = engine
  if (import.meta.env.DEV) {
    // Dev/E2E hook: lets tests read engine state and drive precise interactions.
    ;(window as unknown as Record<string, unknown>).__nodeflow = { engine, uiStore }
  }
  return engine
}
