import type { Side } from '../types'
import type { Board } from '../doc/board'
import {
  createNode,
  createRoot,
  deleteSubtree,
  ephemeralOrigin,
  localOrigin,
  moveNode,
  setCollapsed,
  setManualOffset,
  setNodeText,
  setRootPosition,
} from '../doc/schema'
import {
  clipboardHasContent,
  clipboardRead,
  clipboardWrite,
  duplicateSubtree,
  materializeSubtree,
  serializeSubtree,
} from '../doc/clipboard'
import { pickBalancedSide } from '../layout/mindmapLayout'
import { setSelection, uiStore } from '../state/store'

/**
 * High-level board actions shared by the interaction machine, the text editor
 * overlay and (later) chrome buttons. Selection/edit state lives in the UI
 * store; document mutations go through doc/schema.
 */
export class BoardActions {
  private board: Board
  private editSession: { id: string; originalText: string; createdNew: boolean } | null = null

  constructor(board: Board) {
    this.board = board
  }

  private get mirror() {
    return this.board.mirror
  }

  // ----------------------------------------------------------- structure

  /** Create a child of `parentId` (auto side-balance at depth 1), select it, start editing. */
  addChild(parentId: string, edit = true): string | null {
    const parent = this.mirror.nodes.get(parentId)
    if (!parent) return null
    let side: Side | null
    if (parent.parentId === null && (parent.dir ?? 'both') === 'both') {
      side = pickBalancedSide(
        parent,
        (id) => this.mirror.nodes.get(id),
        (id) => this.mirror.subtreeHeight(id),
      )
    } else {
      side = parent.side
    }
    if (parent.collapsed) setCollapsed(this.board.bd, parentId, false)
    const id = createNode(this.board.bd, parentId, { side })
    setSelection([id])
    if (edit) this.startEdit(id, '', true)
    return id
  }

  /** Create a sibling after `id` (root: create a child instead), select, edit. */
  addSiblingAfter(id: string, edit = true): string | null {
    const node = this.mirror.nodes.get(id)
    if (!node) return null
    if (node.parentId === null) return this.addChild(id, edit)
    const newId = createNode(this.board.bd, node.parentId, { side: node.side }, { afterId: id })
    setSelection([newId])
    if (edit) this.startEdit(newId, '', true)
    return newId
  }

  /** Create a floating root at a world point, select it, start editing. */
  addRootAt(x: number, y: number, edit = true): string {
    const id = createRoot(this.board.bd, { x, y })
    setSelection([id])
    if (edit) this.startEdit(id, '', true)
    return id
  }

  /** Delete the selected subtrees (one undo step each); select the first parent. */
  deleteSelection(): void {
    const sel = [...uiStore.getState().selection]
    if (sel.length === 0) return
    const selSet = new Set(sel)
    const tops = sel.filter((id) => {
      let cur = this.mirror.nodes.get(id)
      while (cur && cur.parentId !== null) {
        if (selSet.has(cur.parentId)) return false
        cur = this.mirror.nodes.get(cur.parentId)
      }
      return true
    })
    const firstParent = tops.length > 0 ? this.mirror.nodes.get(tops[0])?.parentId : null
    this.board.bd.doc.transact(() => {
      for (const id of tops) deleteSubtree(this.board.bd, id)
    }, localOrigin)
    if (firstParent && this.mirror.nodes.has(firstParent)) setSelection([firstParent])
    else setSelection([])
  }

  toggleCollapse(id: string): void {
    const node = this.mirror.nodes.get(id)
    if (!node || node.childrenIds.length === 0) return
    setCollapsed(this.board.bd, id, !node.collapsed)
  }

  // ------------------------------------------------------------- editing

  startEdit(id: string, initialText: string | null, createdNew = false): void {
    const node = this.mirror.nodes.get(id)
    if (!node) return
    this.editSession = { id, originalText: node.text, createdNew }
    const text = initialText ?? node.text
    if (text !== node.text) {
      setNodeText(this.board.bd, id, text, ephemeralOrigin)
    }
    uiStore.setState({ editing: { id, initialText: text } })
  }

  /** Live text while typing — ephemeral origin so the whole edit is one undo step. */
  liveEditText(id: string, text: string): void {
    setNodeText(this.board.bd, id, text, ephemeralOrigin)
  }

  /**
   * Commit the edit as a single undoable step and leave edit mode.
   * A node that started empty and stayed empty is removed (cancels the
   * creation, Miro-style); returns true in that case.
   */
  commitEdit(id: string, text: string): boolean {
    const session = this.editSession
    this.editSession = null
    uiStore.setState({ editing: null })
    const original = session && session.id === id ? session.originalText : null
    if (text === '' && (original ?? '') === '') {
      const node = this.mirror.nodes.get(id)
      if (node && node.childrenIds.length === 0) {
        const parentId = node.parentId
        if (session?.createdNew) {
          // the creation is the last tracked step: undoing it cancels the
          // node without leaving a create+delete pair in history
          this.board.undo.undo()
        } else {
          deleteSubtree(this.board.bd, id)
        }
        if (parentId && this.mirror.nodes.has(parentId)) setSelection([parentId])
        else setSelection([])
        return true
      }
    }
    if (original !== null && original !== text) {
      // restore the pre-edit value ephemerally so the tracked transaction
      // captures original → final (intermediate live writes are untracked)
      setNodeText(this.board.bd, id, original, ephemeralOrigin)
      if (session?.createdNew) {
        // merge the text commit into the creation's undo item: one new node = one undo step
        this.mergeWithPreviousUndoStep(() => setNodeText(this.board.bd, id, text, localOrigin))
      } else {
        setNodeText(this.board.bd, id, text, localOrigin)
      }
    } else {
      setNodeText(this.board.bd, id, text, ephemeralOrigin)
    }
    return false
  }

  /** Run tracked mutations so they merge into the previous undo stack item. */
  private mergeWithPreviousUndoStep(fn: () => void): void {
    const manager = this.board.undo.manager
    const prev = manager.captureTimeout
    manager.captureTimeout = Number.MAX_SAFE_INTEGER
    try {
      fn()
    } finally {
      manager.captureTimeout = prev
    }
  }

  /** Enter while editing: commit, then chain a sibling — unless the empty node ended the chain. */
  commitAndAddSibling(id: string, text: string): void {
    if (!this.commitEdit(id, text)) this.addSiblingAfter(id)
  }

  commitAndAddChild(id: string, text: string): void {
    if (!this.commitEdit(id, text)) this.addChild(id)
  }

  cancelEditKeepText(id: string, text: string): void {
    // Esc commits per SPEC §9 ("Esc commits and exits")
    this.commitEdit(id, text)
  }

  // ------------------------------------------------------ drag & reorder

  /** Selected ids reduced to topmost subtree roots (no node with a selected ancestor). */
  selectionTops(): string[] {
    const sel = [...uiStore.getState().selection]
    const selSet = new Set(sel)
    return sel.filter((id) => {
      let cur = this.mirror.nodes.get(id)
      while (cur && cur.parentId !== null) {
        if (selSet.has(cur.parentId)) return false
        cur = this.mirror.nodes.get(cur.parentId)
      }
      return true
    })
  }

  /**
   * Commit a drag-drop: reparent + fractional-index insert, one transaction.
   * `index` refers to the mirror's insertion universe for (parentId, side).
   */
  dropSubtrees(topIds: string[], parentId: string, index: number, side: Side | null): void {
    const universe = this.mirror
      .insertionUniverse(parentId, side)
      .filter((id) => !topIds.includes(id))
    const ref = index < universe.length ? universe[index] : null
    this.board.bd.doc.transact(() => {
      let prev: string | null = null
      for (const top of topIds) {
        const pos = prev ? { afterId: prev } : ref ? { beforeId: ref } : undefined
        moveNode(this.board.bd, top, parentId, pos, side)
        prev = top
      }
    }, localOrigin)
  }

  /** Live position writes during free-move / root drags (untracked). */
  freeMoveLive(id: string, mx: number, my: number, isRoot: boolean): void {
    if (isRoot) setRootPosition(this.board.bd, id, mx, my, ephemeralOrigin)
    else setManualOffset(this.board.bd, id, mx, my, ephemeralOrigin)
  }

  /** Final free-move commit: restore start ephemerally so one drag = one undo step. */
  freeMoveCommit(
    id: string,
    start: { mx: number; my: number; layout: 'auto' | 'manual' },
    end: { mx: number; my: number },
    isRoot: boolean,
  ): void {
    if (Math.abs(start.mx - end.mx) < 0.01 && Math.abs(start.my - end.my) < 0.01) {
      // no net movement: restore as it was
      if (isRoot) setRootPosition(this.board.bd, id, start.mx, start.my, ephemeralOrigin)
      else if (start.layout === 'manual')
        setManualOffset(this.board.bd, id, start.mx, start.my, ephemeralOrigin)
      return
    }
    if (isRoot) {
      setRootPosition(this.board.bd, id, start.mx, start.my, ephemeralOrigin)
      setRootPosition(this.board.bd, id, end.mx, end.my, localOrigin)
    } else {
      // restore the pre-drag state (incl. layout mode), then commit tracked
      this.board.bd.doc.transact(() => {
        const m = this.board.bd.nodes.get(id)
        if (!m) return
        m.set('layout', start.layout)
        m.set('mx', start.mx)
        m.set('my', start.my)
      }, ephemeralOrigin)
      setManualOffset(this.board.bd, id, end.mx, end.my, localOrigin)
    }
  }

  /** Duplicate subtrees for Alt+drag (single undo step); returns new top ids. */
  duplicateForDrag(topIds: string[]): string[] {
    const out: string[] = []
    this.board.bd.doc.transact(() => {
      for (const id of topIds) {
        const copy = duplicateSubtree(this.board.bd, this.mirror, id)
        if (copy) out.push(copy)
      }
    }, localOrigin)
    setSelection(out)
    return out
  }

  /** Cmd/Ctrl+↑/↓ — swap with the previous/next sibling on the same side. */
  reorderSelected(delta: -1 | 1): void {
    const sel = [...uiStore.getState().selection]
    if (sel.length !== 1) return
    const node = this.mirror.nodes.get(sel[0])
    if (!node || node.parentId === null) return
    const parent = this.mirror.nodes.get(node.parentId)
    if (!parent) return
    const universe = this.mirror.insertionUniverse(node.parentId, node.side)
    const i = universe.indexOf(node.id)
    if (i < 0) return
    const j = i + delta
    if (j < 0 || j >= universe.length) return
    const pos = delta === -1 ? { beforeId: universe[j] } : { afterId: universe[j] }
    moveNode(this.board.bd, node.id, node.parentId, pos, node.side)
  }

  // ----------------------------------------------------- clipboard actions

  copySelection(): void {
    const tops = this.selectionTops()
    const specs = tops
      .map((id) => serializeSubtree(this.mirror, id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
    if (specs.length > 0) clipboardWrite(specs)
  }

  cutSelection(): void {
    this.copySelection()
    this.deleteSelection()
  }

  /** Paste as children of the selected node, or as floating roots at a point. */
  paste(at?: { x: number; y: number }): void {
    if (!clipboardHasContent()) return
    const specs = clipboardRead()
    const sel = [...uiStore.getState().selection]
    const target = sel.length > 0 ? (this.mirror.nodes.get(sel[sel.length - 1]) ?? null) : null
    const newIds: string[] = []
    this.board.bd.doc.transact(() => {
      specs.forEach((spec, i) => {
        if (target) {
          newIds.push(materializeSubtree(this.board.bd, target.id, spec))
        } else {
          const base = at ?? { x: 0, y: 0 }
          newIds.push(
            materializeSubtree(this.board.bd, null, spec, undefined, {
              x: base.x + i * 40,
              y: base.y + i * 40,
            }),
          )
        }
      })
    }, localOrigin)
    if (newIds.length > 0) setSelection(newIds)
  }

  /** Cmd/Ctrl+D — duplicate each selected subtree as its next sibling. */
  duplicateSelection(): void {
    const tops = this.selectionTops()
    if (tops.length === 0) return
    const out: string[] = []
    this.board.bd.doc.transact(() => {
      for (const id of tops) {
        const copy = duplicateSubtree(this.board.bd, this.mirror, id)
        if (copy) out.push(copy)
      }
    }, localOrigin)
    if (out.length > 0) setSelection(out)
  }

  // ---------------------------------------------------------- navigation

  /** Arrow-key navigation: toward parent/child along the layout axis, between siblings across. */
  navigate(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): void {
    const sel = [...uiStore.getState().selection]
    if (sel.length === 0) return
    const node = this.mirror.nodes.get(sel[sel.length - 1])
    if (!node) return
    const rootId = this.mirror.rootOf(node.id)
    const root = this.mirror.nodes.get(rootId)
    const down = root?.dir === 'down'

    const toParent = () => (node.parentId ? this.select(node.parentId) : undefined)
    const toChild = (side?: Side) => {
      if (node.collapsed) return
      const kids = node.childrenIds
        .map((id) => this.mirror.nodes.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c && c.visible)
        .filter((c) => (side ? (c.side ?? 'right') === side : true))
      if (kids.length === 0) return
      const nearest = kids.reduce((best, c) =>
        Math.abs(c.y - node.y) < Math.abs(best.y - node.y) ? c : best,
      )
      this.select(nearest.id)
    }
    const toSibling = (delta: -1 | 1) => {
      if (node.parentId === null) return
      const parent = this.mirror.nodes.get(node.parentId)
      if (!parent) return
      const sibs = parent.childrenIds.filter((id) => {
        const s = this.mirror.nodes.get(id)
        return (
          s &&
          s.visible &&
          (parent.parentId !== null || (s.side ?? 'right') === (node.side ?? 'right'))
        )
      })
      const i = sibs.indexOf(node.id)
      const next = sibs[i + delta]
      if (next) this.select(next)
    }

    if (down) {
      if (key === 'ArrowDown') toChild()
      else if (key === 'ArrowUp') toParent()
      else toSibling(key === 'ArrowLeft' ? -1 : 1)
      return
    }
    // horizontal: which way is "outward" for this node?
    const isRoot = node.parentId === null
    const onLeft = !isRoot && this.sideOf(node.id) === 'left'
    if (key === 'ArrowRight') {
      if (isRoot) toChild('right')
      else if (onLeft) toParent()
      else toChild()
    } else if (key === 'ArrowLeft') {
      if (isRoot) toChild('left')
      else if (onLeft) toChild()
      else toParent()
    } else {
      toSibling(key === 'ArrowUp' ? -1 : 1)
    }
  }

  selectParent(): void {
    const sel = [...uiStore.getState().selection]
    const node = sel.length > 0 ? this.mirror.nodes.get(sel[sel.length - 1]) : undefined
    if (node?.parentId) this.select(node.parentId)
  }

  // -------------------------------------------------------------- helpers

  private select(id: string): void {
    setSelection([id])
  }

  private sideOf(id: string): Side {
    let cur = this.mirror.nodes.get(id)
    while (cur && cur.parentId !== null) {
      const p = this.mirror.nodes.get(cur.parentId)
      if (!p) break
      if (p.parentId === null) return cur.side ?? 'right'
      cur = p
    }
    return 'right'
  }

  undo(): void {
    uiStore.setState({ editing: null })
    this.board.undo.undo()
    this.pruneSelection()
  }

  redo(): void {
    uiStore.setState({ editing: null })
    this.board.undo.redo()
    this.pruneSelection()
  }

  /** Drop selected/hovered ids that no longer exist (after undo/redo/delete). */
  pruneSelection(): void {
    const state = uiStore.getState()
    const live = [...state.selection].filter((id) => this.mirror.nodes.has(id))
    if (live.length !== state.selection.size) setSelection(live)
    if (state.hover && !this.mirror.nodes.has(state.hover)) uiStore.setState({ hover: null })
    if (state.editing && !this.mirror.nodes.has(state.editing.id)) {
      uiStore.setState({ editing: null })
    }
  }
}
