import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Camera } from '../engine/camera'
import type { ThemeMode } from '../theme'
import { applyTheme, initialThemeMode } from '../theme'

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

export interface ContextMenu {
  x: number
  y: number
  targetId: string
  targetType: 'node' | 'link'
}

/** Interaction-machine state kind, mirrored here so chrome can react to it. */
export type GestureKind =
  | 'idle'
  | 'panning'
  | 'pressingNode'
  | 'pressingEmpty'
  | 'marquee'
  | 'draggingNodes'
  | 'draggingFreeMove'
  | 'draggingLink'

export interface UIState {
  camera: Camera
  selection: ReadonlySet<string>
  /** selected cross-link (mutually exclusive with node selection) */
  linkSelection: string | null
  hover: string | null
  editing: EditingState | null
  /** cross-link whose label is being edited inline */
  editingLinkId: string | null
  contextMenu: ContextMenu | null
  /** current interaction-machine state (chrome hides itself mid-gesture) */
  gesture: GestureKind
  tool: Tool
  stylePanelOpen: boolean
  themeMode: ThemeMode
  /** local autosave status shown in the top bar */
  saveState: 'saved' | 'saving'
  searchOpen: boolean
  /** node briefly highlighted after a search jump (renderer-driven animation) */
  searchPulse: { id: string; startedAt: number } | null
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
  contextMenu: null,
  gesture: 'idle',
  tool: 'select',
  stylePanelOpen: false,
  themeMode: initialThemeMode(),
  saveState: 'saved',
  searchOpen: false,
  searchPulse: null,
  spaceDown: false,
  hudVisible: false,
}))

/** Reset per-board UI state when switching boards (camera is set separately). */
export const resetBoardUI = (): void => {
  uiStore.setState({
    selection: new Set(),
    linkSelection: null,
    hover: null,
    editing: null,
    editingLinkId: null,
    contextMenu: null,
    gesture: 'idle',
    tool: 'select',
    saveState: 'saved',
    searchOpen: false,
    searchPulse: null,
  })
}

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

export const showContextMenu = (menu: ContextMenu): void => {
  uiStore.setState({ contextMenu: menu })
}

export const hideContextMenu = (): void => {
  if (uiStore.getState().contextMenu) uiStore.setState({ contextMenu: null })
}

export const setTool = (tool: Tool): void => {
  uiStore.setState({ tool })
}

export const setStylePanelOpen = (open: boolean): void => {
  uiStore.setState({ stylePanelOpen: open })
}

/** Swap the live palette + CSS scope, then notify (engine repaints via subscription). */
export const setThemeMode = (mode: ThemeMode): void => {
  applyTheme(mode)
  uiStore.setState({ themeMode: mode })
}

export const setSearchOpen = (open: boolean): void => {
  uiStore.setState({ searchOpen: open })
}
