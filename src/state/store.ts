import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Camera } from '../engine/camera'

export type Tool = 'select' | 'addRoot' | 'link'

/**
 * Ephemeral UI state only (SPEC §2): selection, tool, camera, hover, edit
 * state. Document truth lives in Yjs. The engine reads via uiStore.getState()
 * — never inside the paint loop hot path except the per-frame camera read.
 */
export interface UIState {
  camera: Camera
  selection: ReadonlySet<string>
  hover: string | null
  editingId: string | null
  tool: Tool
  spaceDown: boolean
  hudVisible: boolean
}

export const uiStore = createStore<UIState>()(() => ({
  camera: { x: 0, y: 0, zoom: 1 },
  selection: new Set<string>(),
  hover: null,
  editingId: null,
  tool: 'select',
  spaceDown: false,
  hudVisible: false,
}))

export function useUI<T>(selector: (s: UIState) => T): T {
  return useStore(uiStore, selector)
}

export const setCamera = (camera: Camera): void => uiStore.setState({ camera })

export const setSelection = (ids: Iterable<string>): void => {
  uiStore.setState({ selection: new Set(ids) })
}

export const clearSelection = (): void => {
  if (uiStore.getState().selection.size > 0) uiStore.setState({ selection: new Set() })
}

export const toggleSelected = (id: string): void => {
  const next = new Set(uiStore.getState().selection)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  uiStore.setState({ selection: next })
}
