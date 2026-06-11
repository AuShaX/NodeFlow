import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Camera } from '../engine/camera'

export type Tool = 'select' | 'addRoot' | 'link'

/**
 * Ephemeral UI state only (SPEC §2): selection, tool, camera, hover, edit
 * state. Document truth lives in Yjs. The engine reads via uiStore.getState()
 * — never inside the paint loop hot path except the per-frame camera read.
 */
export interface EditingState {
  id: string
  /** what the editor should start with (typed-over text or the node's text) */
  initialText: string
}

export interface UIState {
  camera: Camera
  selection: ReadonlySet<string>
  /** selected cross-link (mutually exclusive with node selection) */
  linkSelection: string | null
  hover: string | null
  editing: EditingState | null
  /** cross-link whose label is being edited inline */
  editingLinkId: string | null
  tool: Tool
  spaceDown: boolean
  hudVisible: boolean
}

export const uiStore = createStore<UIState>()(() => ({
  camera: { x: 0, y: 0, zoom: 1 },
  selection: new Set<string>(),
  linkSelection: null,
  hover: null,
  editing: null,
  editingLinkId: null,
  tool: 'select',
  spaceDown: false,
  hudVisible: false,
}))

export function useUI<T>(selector: (s: UIState) => T): T {
  return useStore(uiStore, selector)
}

export const setCamera = (camera: Camera): void => uiStore.setState({ camera })

export const setSelection = (ids: Iterable<string>): void => {
  uiStore.setState({ selection: new Set(ids), linkSelection: null })
}

export const clearSelection = (): void => {
  const s = uiStore.getState()
  if (s.selection.size > 0 || s.linkSelection !== null) {
    uiStore.setState({ selection: new Set(), linkSelection: null })
  }
}

export const toggleSelected = (id: string): void => {
  const next = new Set(uiStore.getState().selection)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  uiStore.setState({ selection: next, linkSelection: null })
}

export const setLinkSelection = (id: string | null): void => {
  uiStore.setState({ linkSelection: id, selection: new Set() })
}
